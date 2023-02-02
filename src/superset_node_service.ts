import { aws_iam, aws_servicediscovery, Duration, Tags } from 'aws-cdk-lib';
import { ISubnet, SecurityGroup } from 'aws-cdk-lib/aws-ec2';
import {
  ContainerDefinitionOptions, ContainerDependencyCondition, ContainerImage, CpuArchitecture,
  DeploymentControllerType,
  FargatePlatformVersion,
  FargateService,
  FargateServiceProps, FargateTaskDefinition,
  ICluster,
  IService, LogDriver, PropagatedTagSource, TaskDefinition,
} from 'aws-cdk-lib/aws-ecs';
import { AccessPoint, FileSystem } from 'aws-cdk-lib/aws-efs';
import { Effect, IRole, PolicyDocument, PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { LogGroup } from 'aws-cdk-lib/aws-logs';
import { DnsRecordType, INamespace, RoutingPolicy, Service, ServiceProps } from 'aws-cdk-lib/aws-servicediscovery';
import * as cloudmap from 'aws-cdk-lib/aws-servicediscovery';
import { Construct } from 'constructs';

export interface SupersetNodeServiceParam {
  namespace: INamespace;
  partition: string;
  region: string;
  cluster: ICluster;
  subnets: ISubnet[];
  securityGroup: SecurityGroup;
  logGroup: LogGroup;
  supersetSvcFileSystem: FileSystem;
  supersetSvcAccessPoint: AccessPoint;
  withExample: string;
  username: string;
  userPassword: string;
}

export class SupersetNodeService {

  public readonly service: IService;

  private readonly taskRole: aws_iam.IRole;
  private readonly executionRole: aws_iam.IRole;
  private readonly scope: Construct;
  private readonly namespace: INamespace;
  private readonly partition: string;
  private readonly clusterName: string;
  private readonly subnets: ISubnet[];
  private readonly securityGroup: SecurityGroup;
  private readonly serviceEntry: cloudmap.IService;
  private readonly cluster: ICluster;
  private readonly region: string;
  private readonly fileSystem: FileSystem;
  private readonly accessPoint: AccessPoint;
  private readonly taskDef: TaskDefinition;
  private readonly logGroup: LogGroup;
  private readonly withExample: string;
  private readonly username: string;
  private readonly userPassword: string;


  constructor(scope: Construct, params: SupersetNodeServiceParam) {
    this.scope = scope;
    this.namespace = params.namespace;
    this.partition = params.partition;
    this.clusterName = params.cluster.clusterName;
    this.subnets = params.subnets;
    this.securityGroup = params.securityGroup;
    this.cluster = params.cluster;
    this.region = params.region;
    this.fileSystem = params.supersetSvcFileSystem;
    this.accessPoint = params.supersetSvcAccessPoint;
    this.logGroup = params.logGroup;
    this.withExample = params.withExample;
    this.username = params.username;
    this.userPassword = params.userPassword;

    this.taskRole = this.supersetNodeTaskRole();
    this.executionRole = this.supersetNodeExecutionRole();
    this.serviceEntry = this.discoveryEntry();
    this.taskDef = this.supersetNodeTaskDef();

    const initContainer = this.taskDef.addContainer('superset-node-init-container', this.initContainerDef());
    const supersetNodeContainer = this.taskDef.addContainer('superset-node-container', this.supersetNodeContainerDef());
    supersetNodeContainer.addMountPoints({
      readOnly: false,
      containerPath: '/app/superset_home',
      sourceVolume: 'superset_home',
    });
    supersetNodeContainer.addContainerDependencies({
      container: initContainer,
      condition: ContainerDependencyCondition.SUCCESS,
    });

    this.service = this.supersetNodeService();
    this.service.node.addDependency(this.fileSystem.mountTargetsAvailable);
  }

  private initContainerDef(): ContainerDefinitionOptions {
    return {
      containerName: 'Supersetnode_ResolvConf_InitContainer',
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

  private supersetNodeService(): IService {
    const supersetService = new FargateService(this.scope, 'superset-node', <FargateServiceProps>{
      cluster: this.cluster,
      maxHealthyPercent: 200,
      minHealthyPercent: 100,
      serviceName: 'superset-node-service',
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
    Tags.of(supersetService).add('com.docker.compose.project', this.cluster.clusterName);
    Tags.of(supersetService).add('com.docker.compose.service', 'superset-node');
    supersetService.associateCloudMapService({
      service: this.serviceEntry,
    });
    return supersetService;
  }

  private supersetNodeContainerDef(): ContainerDefinitionOptions {
    return {
      command: ['/app/docker/docker-frontend.sh'],
      essential: true,
      containerName: 'superset-node',
      environment: {
        COMPOSE_PROJECT_NAME: 'superset',
        CYPRESS_CONFIG: 'false',
        DATABASE_DB: 'superset',
        DATABASE_DIALECT: 'postgresql',
        DATABASE_HOST: 'db',
        DATABASE_PASSWORD: 'superset',
        DATABASE_PORT: '5432',
        DATABASE_USER: 'superset',
        FLASK_ENV: 'development',
        POSTGRES_DB: 'superset',
        POSTGRES_PASSWORD: 'superset',
        POSTGRES_USER: 'superset',
        PYTHONPATH: '/app/pythonpath:/app/docker/pythonpath_dev',
        REDIS_HOST: 'redis',
        REDIS_PORT: '6379',
        SUPERSET_ENV: 'development',
        SUPERSET_LOAD_EXAMPLES: this.withExample,
        SUPERSET_PORT: '8088',
        SUPERSET_USER: this.username,
        SUPERSET_PASSWORD: this.userPassword,
      },
      image: ContainerImage.fromRegistry('public.ecr.aws/p9r6s5p7/superset-node:v2.0.0'),
      logging: LogDriver.awsLogs({
        logGroup: this.logGroup,
        streamPrefix: this.clusterName,
      }),
    };
  }

  private supersetNodeTaskDef(): TaskDefinition {
    return new FargateTaskDefinition(this.scope, 'superset-node-taskdef', {
      cpu: 4096,
      memoryLimitMiB: 8192,
      taskRole: this.taskRole,
      executionRole: this.executionRole,
      family: `${this.clusterName}-superset-node`,
      runtimePlatform: {
        cpuArchitecture: CpuArchitecture.X86_64,
      },
      volumes: [{
        name: 'superset_home',
        efsVolumeConfiguration: {
          authorizationConfig: {
            accessPointId: this.accessPoint.accessPointId,
            iam: 'ENABLED',
          },
          transitEncryption: 'ENABLED',
          fileSystemId: this.fileSystem.fileSystemId,
        },
      }],
    });
  }

  private discoveryEntry(): Service {
    return new aws_servicediscovery.Service(this.scope, 'superset-node-discovery-entry', <ServiceProps>{
      description: 'Entry for "superset-node" service discovery in AWS Cloud Map.',
      name: 'superset-node',
      namespace: this.namespace,
      customHealthCheck: {
        failureThreshold: 1,
      },
      dnsTtl: Duration.seconds(60),
      routingPolicy: RoutingPolicy.MULTIVALUE,
      dnsRecordType: DnsRecordType.A,
    });
  }

  private supersetNodeExecutionRole(): aws_iam.IRole {
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
    const dbExecutionRole = new aws_iam.Role(this.scope, 'superset-node-execrole', {
      assumedBy: principal,
    });
    dbExecutionRole.addManagedPolicy({ managedPolicyArn: `arn:${this.partition}:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy` });
    dbExecutionRole.addManagedPolicy({ managedPolicyArn: `arn:${this.partition}:iam::aws:policy/AmazonEC2ContainerRegistryReadOnly` });
    Tags.of(dbExecutionRole).add('com.docker.compose.project', this.clusterName);
    Tags.of(dbExecutionRole).add('com.docker.compose.service', 'superset-node');
    return dbExecutionRole;
  }

  private supersetNodeTaskRole(): IRole {
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
    const svcTaskRole = new aws_iam.Role(this.scope, 'superset-node-taskrole', {
      assumedBy: principal,
    });

    svcTaskRole.addToPolicy(new PolicyStatement(
      {
        conditions: {
          StringEquals: { 'elasticfilesystem:AccessPointArn': this.accessPoint.accessPointArn },
        },
        resources: [this.fileSystem.fileSystemArn],
        effect: Effect.ALLOW,
        actions: [
          'elasticfilesystem:ClientMount',
          'elasticfilesystem:ClientWrite',
          'elasticfilesystem:ClientRootAccess',
        ],
      },
    ));
    Tags.of(svcTaskRole).add('com.docker.compose.project', this.clusterName);
    Tags.of(svcTaskRole).add('com.docker.compose.service', 'superset-node');
    return svcTaskRole;
  }
}


