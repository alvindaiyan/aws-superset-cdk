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


export interface SupersetInitServiceParam {
  partition: string;
  cluster: ICluster;
  supersetSvcFileSystem: FileSystem;
  supersetSvcAccessPoint: AccessPoint;
  securityGroup: SecurityGroup;
  namespace: INamespace;
  subnets: ISubnet[];
  region: string;
  logGroup: LogGroup;
  withExample: string;
  username: string;
  userPassword: string;
  installProphet: string;
}

export class SupersetInitService {

  private readonly taskRole: aws_iam.IRole;
  private readonly executionRole: aws_iam.IRole;
  private readonly scope: Construct;
  private readonly partition: string;
  private readonly clusterName: string;
  private readonly cluster: ICluster;
  private readonly fileSystem: FileSystem;
  private readonly accessPoint: AccessPoint;
  private readonly namespace: INamespace;
  private readonly securityGroup: SecurityGroup;
  private readonly serviceEntry: cloudmap.IService;
  private readonly subnets: ISubnet[];
  private readonly taskDef: TaskDefinition;
  private readonly region: string;
  private readonly logGroup: LogGroup;
  private readonly withExample: string;
  private readonly username: string;
  private readonly userPassword: string;
  private readonly installProphet: string;

  constructor(scope: Construct, params: SupersetInitServiceParam) {
    this.scope = scope;
    this.partition = params.partition;
    this.clusterName = params.cluster.clusterName;
    this.cluster = params.cluster;
    this.fileSystem = params.supersetSvcFileSystem;
    this.accessPoint = params.supersetSvcAccessPoint;
    this.namespace = params.namespace;
    this.securityGroup = params.securityGroup;
    this.subnets = params.subnets;
    this.region = params.region;
    this.logGroup = params.logGroup;
    this.withExample = params.withExample;
    this.username = params.username;
    this.userPassword = params.userPassword;
    this.installProphet = params.installProphet;

    this.taskRole = this.supersetInitSvcTaskRole();
    this.executionRole = this.supersetInitTaskExecutionRole();
    this.serviceEntry = this.discoveryEntry();
    this.taskDef = this.supersetInitTaskDef();
    const initContainer = this.taskDef.addContainer('superset-init-init-container', this.initContainerDef());
    const supersetInitContainer = this.taskDef.addContainer('superset-init-container', this.supersetInitContainerDef());
    const supersetInitCleanUpContainer = this.taskDef.addContainer('superset-init-cleanup-container', this.supersetInitCleanUpContainerDef());
    supersetInitContainer.addMountPoints({
      readOnly: false,
      containerPath: '/app/superset_home',
      sourceVolume: 'superset_home',
    });
    supersetInitContainer.addContainerDependencies({
      container: initContainer,
      condition: ContainerDependencyCondition.SUCCESS,
    });
    supersetInitCleanUpContainer.addContainerDependencies({
      container: supersetInitContainer,
      condition: ContainerDependencyCondition.SUCCESS,
    });

    this.supersetInitService();
  }


  private supersetInitService(): IService {
    const supersetService = new FargateService(this.scope, 'superset-init', <FargateServiceProps>{
      cluster: this.cluster,
      maxHealthyPercent: 200,
      minHealthyPercent: 100,
      serviceName: 'supersetInitService',
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
    Tags.of(supersetService).add('com.docker.compose.service', 'superset-init');
    supersetService.associateCloudMapService({
      service: this.serviceEntry,
    });
    return supersetService;
  }

  private supersetInitTaskDef(): TaskDefinition {
    return new FargateTaskDefinition(this.scope, 'superset-init-taskdef', {
      cpu: 512,
      family: `${this.clusterName}-init-superset`,
      memoryLimitMiB: 1024,
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

  private supersetInitContainerDef(): ContainerDefinitionOptions {
    return {
      command: [
        '/app/docker/docker-init.sh',
      ],
      essential: false,
      image: ContainerImage.fromRegistry('public.ecr.aws/p9r6s5p7/superset:v2.0.0'),
      logging: LogDriver.awsLogs({
        logGroup: this.logGroup,
        streamPrefix: this.clusterName,
      }),
      user: 'root',
      containerName: 'superset-init',
      environment: {
        COMPOSE_PROJECT_NAME: 'superset',
        CYPRESS_CONFIG: '',
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
        InstallProphet: this.installProphet,
      },
    };
  }

  private supersetInitCleanUpContainerDef(): ContainerDefinitionOptions {
    return {
      command: [
        'ecs', 'update-service', '--cluster', this.clusterName, '--service', 'supersetInitService', '--desired-count', '0',
      ],
      essential: true,
      image: ContainerImage.fromRegistry('amazon/aws-cli'),
      logging: LogDriver.awsLogs({
        logGroup: this.logGroup,
        streamPrefix: this.clusterName,
      }),
      containerName: 'superset-init-cleanup',
    };
  }

  private initContainerDef(): ContainerDefinitionOptions {
    return {
      containerName: 'Supersetinit_ResolvConf_InitContainer',
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

  private discoveryEntry(): Service {
    return new aws_servicediscovery.Service(this.scope, 'superset-init-discovery-entry', <ServiceProps>{
      description: 'Entry for "superset-init" service discovery in AWS Cloud Map.',
      name: 'superset-init',
      namespace: this.namespace,
      customHealthCheck: {
        failureThreshold: 1,
      },
      dnsTtl: Duration.seconds(60),
      routingPolicy: RoutingPolicy.MULTIVALUE,
      dnsRecordType: DnsRecordType.A,
    });
  }

  private supersetInitTaskExecutionRole(): IRole {
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
    const dbExecutionRole = new aws_iam.Role(this.scope, 'superset-init-execrole', {
      assumedBy: principal,
    });
    dbExecutionRole.addManagedPolicy({ managedPolicyArn: `arn:${this.partition}:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy` });
    dbExecutionRole.addManagedPolicy({ managedPolicyArn: `arn:${this.partition}:iam::aws:policy/AmazonEC2ContainerRegistryReadOnly` });
    Tags.of(dbExecutionRole).add('com.docker.compose.project', this.clusterName);
    Tags.of(dbExecutionRole).add('com.docker.compose.service', 'superset-init');
    return dbExecutionRole;
  }

  private supersetInitSvcTaskRole(): IRole {
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
    const svcTaskRole = new aws_iam.Role(this.scope, 'superset-init-taskrole', {
      assumedBy: principal,
    });
    svcTaskRole.addManagedPolicy({
      managedPolicyArn: `arn:${this.partition}:iam::aws:policy/AmazonECS_FullAccess`,
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
    Tags.of(svcTaskRole).add('com.docker.compose.service', 'superset-init');
    return svcTaskRole;
  }
}
