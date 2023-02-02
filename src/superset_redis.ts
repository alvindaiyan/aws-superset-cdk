import { aws_ecs, aws_efs, aws_iam, aws_servicediscovery, Duration, RemovalPolicy, Tags } from 'aws-cdk-lib';
import { ISubnet, IVpc, SecurityGroup } from 'aws-cdk-lib/aws-ec2';
import {
  ContainerDefinitionOptions,
  ContainerDependencyCondition,
  ContainerImage,
  CpuArchitecture,
  DeploymentControllerType,
  FargatePlatformVersion,
  FargateServiceProps,
  FargateTaskDefinitionProps,
  IService,
  LogDriver,
  PropagatedTagSource,
  Protocol,
  TaskDefinition,
} from 'aws-cdk-lib/aws-ecs';
import { AccessPoint, FileSystem, FileSystemProps } from 'aws-cdk-lib/aws-efs';
import { Effect, PolicyDocument, PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { LogGroup } from 'aws-cdk-lib/aws-logs';
import * as cloudmap from 'aws-cdk-lib/aws-servicediscovery';
import { DnsRecordType, RoutingPolicy, ServiceProps } from 'aws-cdk-lib/aws-servicediscovery';
import { Construct } from 'constructs';

export interface SupersetRedisParam {
  ecsCluster: aws_ecs.ICluster;
  subnets: ISubnet[];
  securityGroup: SecurityGroup;
  serviceNamespace: aws_servicediscovery.INamespace;
  region: string;
  logGroup: LogGroup;
  partition: string;
  vpc: IVpc;
}


export class SupersetRedis {

  public readonly service: IService;
  public readonly fs: FileSystem;

  private readonly scope: Construct;
  private readonly clusterName: string;
  private readonly cluster: aws_ecs.ICluster;
  private readonly subnets: ISubnet[];
  private readonly securityGroup: SecurityGroup;
  private readonly serviceEntry: cloudmap.IService;
  private readonly namespace: aws_servicediscovery.INamespace;
  private readonly ap: AccessPoint;
  private readonly region: string;
  private readonly logGroup: LogGroup;
  private readonly executionRole: aws_iam.IRole;
  private readonly taskRole: aws_iam.IRole;
  private readonly partition: string;
  private readonly taskDef: aws_ecs.TaskDefinition;
  private readonly vpc: IVpc;

  constructor(scope: Construct, params: SupersetRedisParam ) {
    this.scope = scope;
    this.clusterName = params.ecsCluster.clusterName;
    this.subnets = params.subnets;
    this.securityGroup = params.securityGroup;
    this.cluster = params.ecsCluster;
    this.namespace = params.serviceNamespace;
    this.region = params.region;
    this.logGroup = params.logGroup;
    this.partition = params.partition;
    this.vpc = params.vpc;

    [this.fs, this.ap] = this.redisFileSystem();
    this.serviceEntry = this.redisServiceDiscoveryEntry();
    this.taskRole = this.getRedisTaskRole();
    this.executionRole = this.getRedisExecutionRole();
    this.taskDef = this.redisTaskDef();
    this.taskDef.node.addDependency(this.fs.mountTargetsAvailable);

    const initContainer = this.taskDef.addContainer('superset-redis-init-container', this.initContainerDef());
    const redisContainer = this.taskDef.addContainer('superset-redis-container', this.redisContainerDef());

    redisContainer.addMountPoints({
      readOnly: false,
      containerPath: '/data',
      sourceVolume: 'redis',
    });
    redisContainer.addContainerDependencies({
      container: initContainer,
      condition: ContainerDependencyCondition.SUCCESS,
    });

    this.service = this.redisService();
  }

  private redisService(): IService {
    const redisService = new aws_ecs.FargateService(this.scope, 'superset-redis-svc', <FargateServiceProps>{
      cluster: this.cluster,
      maxHealthyPercent: 200,
      minHealthyPercent: 100,
      serviceName: 'superset-redis-service',
      deploymentController: {
        type: DeploymentControllerType.ECS,
      },
      desiredCount: 1,
      assignPublicIp: true,
      securityGroups: [this.securityGroup],
      vpcSubnets: this.subnets,
      platformVersion: FargatePlatformVersion.VERSION1_4,
      propagateTags: PropagatedTagSource.SERVICE,
      taskDefinition: this.taskDef,
    });
    Tags.of(redisService).add('com.docker.compose.project', this.cluster.clusterName);
    Tags.of(redisService).add('com.docker.compose.service', 'redis');
    redisService.associateCloudMapService({
      service: this.serviceEntry,
    });
    return redisService;
  }

  private redisTaskDef(): TaskDefinition {
    return new aws_ecs.FargateTaskDefinition(this.scope, 'superset-redis-taskdef', <FargateTaskDefinitionProps>{
      cpu: 256,
      family: `${this.clusterName}-redis`,
      memoryLimitMiB: 512,
      volumes: [
        {
          name: 'redis',
          efsVolumeConfiguration: {
            authorizationConfig: {
              accessPointId: this.ap.accessPointId,
              iam: 'ENABLED',
            },
            transitEncryption: 'ENABLED',
            fileSystemId: this.fs.fileSystemId,
          },
        },
      ],
      runtimePlatform: {
        cpuArchitecture: CpuArchitecture.X86_64,
      },
      executionRole: this.executionRole,
      taskRole: this.taskRole,
    });
  }

  private initContainerDef(): ContainerDefinitionOptions {
    return {
      containerName: 'Redis_ResolvConf_InitContainer',
      image: ContainerImage.fromRegistry('docker/ecs-searchdomain-sidecar:1.0'),
      essential: false,
      logging: LogDriver.awsLogs({
        logGroup: this.logGroup,
        streamPrefix: this.clusterName,
      }),
      command: [
        // private DNS hostnames by default in format of ip-private-ipv4-address.region.compute.internal
        `${this.region}.compute.internal`,
        // namespace name created in cloud map
        `${this.clusterName}.local`,
      ],
    };
  }

  private redisContainerDef(): ContainerDefinitionOptions {
    return <ContainerDefinitionOptions>{
      containerName: 'redis',
      image: ContainerImage.fromRegistry('docker.io/library/redis:7.0@sha256:5050c3b85c308ec9e9eafb8ac7b3a8742a61cdb298d79851141a500491d45baf'),
      essential: true,
      logging: LogDriver.awsLogs({
        logGroup: this.logGroup,
        streamPrefix: this.clusterName,
      }),
      portMappings: [{
        containerPort: 6379,
        hostPort: 6379,
        protocol: Protocol.TCP,
      }],
    };
  }

  private redisServiceDiscoveryEntry(): aws_servicediscovery.Service {
    return new aws_servicediscovery.Service(this.scope, 'superset-redis-discovery-entry', <ServiceProps>{
      description: 'Entry for "redis" service discovery in AWS Cloud Map.',
      name: 'redis',
      namespace: this.namespace,
      customHealthCheck: {
        failureThreshold: 1,
      },
      routingPolicy: RoutingPolicy.MULTIVALUE,
      dnsTtl: Duration.seconds(60),
      dnsRecordType: DnsRecordType.A,
    });
  }

  private redisFileSystem(): [FileSystem, AccessPoint] {
    const fs = new aws_efs.FileSystem(this.scope, 'superset-redis-fs', <FileSystemProps>{
      removalPolicy: RemovalPolicy.DESTROY,
      encrypted: true,
      vpc: this.vpc,
      securityGroup: this.securityGroup,
    });
    Tags.of(fs).add('com.docker.compose.project', this.clusterName);
    Tags.of(fs).add('com.docker.compose.volume', 'redis');
    Tags.of(fs).add('Name', `${this.clusterName}_redis`);

    const ap = new AccessPoint(this.scope, 'superset-redis-ap', {
      fileSystem: fs,
    });
    Tags.of(ap).add('com.docker.compose.project', this.clusterName);
    Tags.of(ap).add('com.docker.compose.volume', 'redis');
    Tags.of(ap).add('Name', `${this.clusterName}_redis`);
    // for (let id in this.subnets) {
    //   new CfnMountTarget(this.scope, `superset-redis-mount-target-${id}`, {
    //     fileSystemId: fs.fileSystemId,
    //     securityGroups: [this.securityGroup.securityGroupId],
    //     subnetId: this.subnets[id].subnetId,
    //   });
    // }
    return [fs, ap];
  }

  private getRedisExecutionRole(): aws_iam.IRole {
    const principal = new aws_iam.ServicePrincipal('ecs-tasks.amazonaws.com');
    principal.addToAssumeRolePolicy(new PolicyDocument(
      {
        statements: [
          new PolicyStatement({
            actions: [
              'sts:AssumeRole',
            ],
            conditions: [],
            effect: Effect.ALLOW,
            principals: [
              new aws_iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
            ],
          }),
        ],
      },
    ));
    const redisExecutionRole = new aws_iam.Role(this.scope, 'superset-redis-execrole', {
      assumedBy: principal,
    });
    redisExecutionRole.addManagedPolicy({ managedPolicyArn: `arn:${this.partition}:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy` });
    redisExecutionRole.addManagedPolicy({ managedPolicyArn: `arn:${this.partition}:iam::aws:policy/AmazonEC2ContainerRegistryReadOnly` });

    Tags.of(redisExecutionRole).add('com.docker.compose.project', this.clusterName);
    Tags.of(redisExecutionRole).add('com.docker.compose.service', 'redis');
    return redisExecutionRole;
  }

  private getRedisTaskRole(): aws_iam.IRole {
    const principal = new aws_iam.ServicePrincipal('ecs-tasks.amazonaws.com');
    principal.addToAssumeRolePolicy(new PolicyDocument(
      {
        statements: [
          new PolicyStatement({
            actions: [
              'sts:AssumeRole',
            ],
            conditions: [],
            effect: Effect.ALLOW,
            principals: [
              new aws_iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
            ],
          }),
        ],
      },
    ));
    const dbTaskRole = new aws_iam.Role(this.scope, 'superset-redis-taskrole', {
      assumedBy: principal,
    });
    dbTaskRole.addToPolicy(new PolicyStatement(
      {
        conditions: {
          StringEquals: { 'elasticfilesystem:AccessPointArn': this.ap.accessPointArn },
        },
        resources: [this.fs.fileSystemArn],
        effect: Effect.ALLOW,
        actions: [
          'elasticfilesystem:ClientMount',
          'elasticfilesystem:ClientWrite',
          'elasticfilesystem:ClientRootAccess',
        ],
      },
    ));
    Tags.of(dbTaskRole).add('com.docker.compose.project', this.clusterName);
    Tags.of(dbTaskRole).add('com.docker.compose.service', 'redis');
    return dbTaskRole;
  }
}