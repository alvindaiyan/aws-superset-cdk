import {
  aws_ecs,
  aws_efs,
  aws_elasticloadbalancingv2,
  aws_iam,
  aws_servicediscovery,
  Duration,
  RemovalPolicy,
  Tags,
} from 'aws-cdk-lib';
import { ISubnet, IVpc, SecurityGroup } from 'aws-cdk-lib/aws-ec2';
import {
  ContainerDefinitionOptions,
  ContainerDependencyCondition,
  ContainerImage, CpuArchitecture,
  DeploymentControllerType,
  FargatePlatformVersion,
  FargateService,
  FargateServiceProps,
  FargateTaskDefinition,
  ICluster,
  IService,
  LogDriver,
  PropagatedTagSource,
  TaskDefinition,
} from 'aws-cdk-lib/aws-ecs';
import { AccessPoint, FileSystem, FileSystemProps } from 'aws-cdk-lib/aws-efs';
import {
  IListener,
  INetworkLoadBalancer,
  NetworkListener,
  NetworkListenerAction,
  NetworkTargetGroup,
  Protocol,
  TargetType,
} from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import { Effect, IRole, PolicyDocument, PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { LogGroup } from 'aws-cdk-lib/aws-logs';
import * as cloudmap from 'aws-cdk-lib/aws-servicediscovery';
import { DnsRecordType, INamespace, RoutingPolicy, Service, ServiceProps } from 'aws-cdk-lib/aws-servicediscovery';
import { Construct } from 'constructs';

export interface SupersetServiceParam {
  namespace: INamespace;
  partition: string;
  region: string;
  cluster: ICluster;
  subnets: ISubnet[];
  securityGroup: SecurityGroup;
  vpc: IVpc;
  loadbalancer: INetworkLoadBalancer;
  logGroup: LogGroup;
  withExample: string;
  username: string;
  userPassword: string;
  secretKey: string;
  installProphet: string;
}

export class SupersetService {
  public readonly fileSystem: FileSystem;
  public readonly accessPoint: AccessPoint;
  public readonly service: IService;
  public readonly listener: IListener;
  public readonly targetGroup: NetworkTargetGroup;
  public readonly lb: INetworkLoadBalancer;

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
  private readonly vpc: IVpc;
  private readonly logGroup: LogGroup;
  private readonly region: string;
  private readonly taskDef: TaskDefinition;
  private readonly withExample: string;
  private readonly username: string;
  private readonly userPassword: string;
  private readonly secretKey: string;
  private readonly installProphet: string;

  constructor(scope: Construct, params: SupersetServiceParam) {
    this.scope = scope;
    this.namespace = params.namespace;
    this.partition = params.partition;
    this.clusterName = params.cluster.clusterName;
    this.subnets = params.subnets;
    this.securityGroup = params.securityGroup;
    this.cluster = params.cluster;
    this.vpc = params.vpc;
    this.lb = params.loadbalancer;
    this.logGroup = params.logGroup;
    this.region = params.region;
    this.withExample = params.withExample;
    this.username = params.username;
    this.userPassword = params.userPassword;
    this.secretKey = params.secretKey;
    this.installProphet = params.installProphet;

    [this.fileSystem, this.accessPoint] = this.supersetServiceFileSystem();
    this.taskRole = this.supersetServiceTaskRole();
    this.executionRole = this.supersetServiceExecutionRole();
    this.serviceEntry = this.discoveryEntry();
    this.targetGroup = this.supersetTCP8088TargetGroup();
    this.taskDef = this.supersetServiceTaskDef();

    const initContainer = this.taskDef.addContainer('superset-svc-init-container', this.initContainerDef());
    const supersetSvcContainer = this.taskDef.addContainer('superset-svc-container', this.supersetSvcContainer());
    supersetSvcContainer.addMountPoints({
      readOnly: false,
      containerPath: '/app/superset_home',
      sourceVolume: 'superset_home',
    });
    supersetSvcContainer.addContainerDependencies({
      container: initContainer,
      condition: ContainerDependencyCondition.SUCCESS,
    });

    this.listener = this.supersetTCP8088Listener();
    this.service = this.supersetService();
    this.service.node.addDependency(this.listener, this.fileSystem.mountTargetsAvailable);
  }

  private initContainerDef(): ContainerDefinitionOptions {
    return {
      containerName: 'Superset_ResolvConf_InitContainer',
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

  private supersetSvcContainer(): ContainerDefinitionOptions {
    return {
      user: 'root',
      containerName: 'superset',
      image: ContainerImage.fromRegistry('public.ecr.aws/p9r6s5p7/superset:v3.0.0'),
      essential: true,
      logging: LogDriver.awsLogs({
        logGroup: this.logGroup,
        streamPrefix: this.clusterName,
      }),
      environment: {
        COMPOSE_PROJECT_NAME: 'superset',
        CYPRESS_CONFIG: '',
        DATABASE_DB: 'superset',
        DATABASE_DIALECT: 'postgresql',
        DATABASE_HOST: 'db',
        DATABASE_PASSWORD: 'superset',
        DATABASE_PORT: '5432',
        DATABASE_USER: 'superset',
        FLASK_DEBUG: 'true',
        POSTGRES_DB: 'superset',
        POSTGRES_PASSWORD: 'superset',
        POSTGRES_USER: 'superset',
        PYTHONPATH: '/app/pythonpath:/app/docker/pythonpath_dev:/app/superset_home',
        REDIS_HOST: 'redis',
        REDIS_PORT: '6379',
        SUPERSET_ENV: 'development',
        SUPERSET_LOAD_EXAMPLES: this.withExample,
        SUPERSET_PORT: '8088',
        SUPERSET_USER: this.username,
        SUPERSET_PASSWORD: this.userPassword,
        SECRET_KEY: this.secretKey,
        InstallProphet: this.installProphet,
      },
      portMappings: [{
        containerPort: 8088,
        hostPort: 8088,
        protocol: aws_ecs.Protocol.TCP,
      }],
      command: [
        '/app/docker/docker-bootstrap.sh',
        'app',
      ],
    };
  }

  private supersetServiceTaskDef(): TaskDefinition {
    return new FargateTaskDefinition(this.scope, 'superset-svc-taskdef', {
      cpu: 4096,
      family: `${this.clusterName}-superset`,
      memoryLimitMiB: 16384,
      volumes: [
        {
          name: 'superset_home',
          efsVolumeConfiguration: {
            authorizationConfig: {
              accessPointId: this.accessPoint.accessPointId,
              iam: 'ENABLED',
            },
            transitEncryption: 'ENABLED',
            fileSystemId: this.fileSystem.fileSystemId,
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

  private supersetService(): IService {
    const supersetService = new FargateService(this.scope, 'superset-service', <FargateServiceProps>{
      cluster: this.cluster,
      maxHealthyPercent: 200,
      minHealthyPercent: 100,
      serviceName: 'superset-service',
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
      enableExecuteCommand: true,
    });
    const target = supersetService.loadBalancerTarget({
      containerName: 'superset',
      containerPort: 8088,
    });
    target.attachToNetworkTargetGroup(this.targetGroup);
    Tags.of(supersetService).add('com.docker.compose.project', this.cluster.clusterName);
    Tags.of(supersetService).add('com.docker.compose.service', 'superset');
    supersetService.associateCloudMapService({
      service: this.serviceEntry,
    });
    return supersetService;
  }

  private supersetTCP8088Listener(): aws_elasticloadbalancingv2.IListener {
    return new NetworkListener(this.scope, 'superset-svc-listener', {
      port: 8088,
      protocol: Protocol.TCP,
      loadBalancer: this.lb,
      defaultAction: NetworkListenerAction.forward([this.targetGroup]),
    });
  }

  private supersetTCP8088TargetGroup(): aws_elasticloadbalancingv2.NetworkTargetGroup {
    const targetGroup = new NetworkTargetGroup(this.scope, 'superset-svc-target-gp', {
      port: 8088,
      protocol: Protocol.TCP,
      targetType: TargetType.IP,
      vpc: this.vpc,
    });
    Tags.of(targetGroup).add('com.docker.compose.project', this.clusterName);
    return targetGroup;
  }

  private discoveryEntry(): Service {
    return new aws_servicediscovery.Service(this.scope, 'superset-service-discovery-entry', <ServiceProps>{
      description: 'Entry for "superset" service discovery in AWS Cloud Map.',
      name: 'superset',
      namespace: this.namespace,
      customHealthCheck: {
        failureThreshold: 1,
      },
      dnsTtl: Duration.seconds(60),
      routingPolicy: RoutingPolicy.MULTIVALUE,
      dnsRecordType: DnsRecordType.A,
    });
  }


  private supersetServiceExecutionRole(): aws_iam.IRole {
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
    const dbExecutionRole = new aws_iam.Role(this.scope, 'superset-svc-execrole', {
      assumedBy: principal,
    });
    dbExecutionRole.addManagedPolicy({ managedPolicyArn: `arn:${this.partition}:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy` });
    dbExecutionRole.addManagedPolicy({ managedPolicyArn: `arn:${this.partition}:iam::aws:policy/AmazonEC2ContainerRegistryReadOnly` });
    Tags.of(dbExecutionRole).add('com.docker.compose.project', this.clusterName);
    Tags.of(dbExecutionRole).add('com.docker.compose.service', 'superset');
    return dbExecutionRole;
  }

  private supersetServiceTaskRole(): IRole {
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
    const svcTaskRole = new aws_iam.Role(this.scope, 'superset-superset-taskrole', {
      assumedBy: principal,
    });
    svcTaskRole.addManagedPolicy({
      managedPolicyArn: `arn:${this.partition}:iam::aws:policy/AmazonS3FullAccess`,
    });
    svcTaskRole.addManagedPolicy({
      managedPolicyArn: `arn:${this.partition}:iam::aws:policy/AmazonAthenaFullAccess`,
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
    Tags.of(svcTaskRole).add('com.docker.compose.service', 'superset');
    return svcTaskRole;
  }

  private supersetServiceFileSystem(): [FileSystem, AccessPoint] {
    const fs = new aws_efs.FileSystem(this.scope, 'superset-svc-fs', <FileSystemProps>{
      removalPolicy: RemovalPolicy.DESTROY,
      encrypted: true,
      vpc: this.vpc,
      securityGroup: this.securityGroup,
    });
    Tags.of(fs).add('com.docker.compose.project', this.clusterName);
    Tags.of(fs).add('com.docker.compose.volume', 'superset_home');
    Tags.of(fs).add('Name', `${this.clusterName}_superset_home`);

    const ap = new AccessPoint(this.scope, 'superset-svc-ap', {
      fileSystem: fs,
    });
    Tags.of(ap).add('com.docker.compose.project', this.clusterName);
    Tags.of(ap).add('com.docker.compose.volume', 'superset_home');
    Tags.of(ap).add('Name', `${this.clusterName}_superset_home`);
    // FileSystem will create mount targets
    // for (let id in this.subnets) {
    //   new CfnMountTarget(this.scope, `superset-svc-mount-target-${id}`, {
    //     fileSystemId: fs.fileSystemId,
    //     securityGroups: [this.securityGroup.securityGroupId],
    //     subnetId: this.subnets[id].subnetId,
    //   });
    // }

    return [fs, ap];
  }
}


