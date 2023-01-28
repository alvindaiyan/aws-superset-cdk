import { aws_ecs, aws_efs, aws_iam, aws_servicediscovery, Duration, RemovalPolicy, Tags } from 'aws-cdk-lib';
import { ISubnet, IVpc, SecurityGroup } from 'aws-cdk-lib/aws-ec2';
import {
  ContainerDefinitionOptions,
  ContainerDependencyCondition,
  ContainerImage,
  CpuArchitecture,
  FargatePlatformVersion,
  FargateServiceProps,
  FargateTaskDefinitionProps,
  IService,
  LogDriver,
  PropagatedTagSource,
  Protocol,
} from 'aws-cdk-lib/aws-ecs';
import { AccessPointProps, FileSystemProps } from 'aws-cdk-lib/aws-efs';
import { Effect, PolicyDocument, PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { LogGroup } from 'aws-cdk-lib/aws-logs';
import * as cloudmap from 'aws-cdk-lib/aws-servicediscovery';
import { DnsRecordType, RoutingPolicy, ServiceProps } from 'aws-cdk-lib/aws-servicediscovery';
import { Construct } from 'constructs';

export interface SupersetDatabaseParam {
  serviceNamespace: aws_servicediscovery.INamespace;
  ecsCluster: aws_ecs.ICluster;
  partition: string;
  region: string;
  logGroup: LogGroup;
  withExample: string;
  username: string;
  userPassword: string;
  securityGroup: SecurityGroup;
  subnets: ISubnet[];
  vpc: IVpc;
}

export class SupersetDatabase {
  public readonly taskRole: aws_iam.IRole;
  public readonly executionRole: aws_iam.IRole;
  public readonly fileSystem: aws_efs.FileSystem;
  public readonly accessPoint: aws_efs.AccessPoint;
  public readonly service: IService;

  private readonly taskDef: aws_ecs.TaskDefinition;
  private readonly namespace: aws_servicediscovery.INamespace;
  private readonly scope: Construct;
  private readonly clusterName: string;
  private readonly partition: string;
  private readonly region: string;
  private readonly logGroup: LogGroup;
  private readonly username: string;
  private readonly userPassword: string;
  private readonly withExample: string;
  private readonly cluster: aws_ecs.ICluster;
  private readonly securityGroup: SecurityGroup;
  private readonly subnets: ISubnet[];
  private readonly serviceEntry: cloudmap.IService;
  private readonly vpc: IVpc;

  constructor(scope: Construct, params: SupersetDatabaseParam) {
    this.namespace = params.serviceNamespace;
    this.scope = scope;
    this.clusterName = params.ecsCluster.clusterName;
    this.partition = params.partition;
    this.region = params.region;
    this.logGroup = params.logGroup;
    this.username = params.username;
    this.userPassword = params.userPassword;
    this.withExample = params.withExample;
    this.cluster = params.ecsCluster;
    this.securityGroup = params.securityGroup;
    this.subnets = params.subnets;
    this.vpc = params.vpc;


    this.serviceEntry = this.serviceRegistry();
    [this.fileSystem, this.accessPoint] = this.dbHomeFileSystem();
    this.taskRole = this.getDBTaskRole();
    this.executionRole = this.getDBExecutionRole();
    this.taskDef = this.dbTaskDef();

    const initContainer = this.taskDef.addContainer('superset-db-container-initial', this.initContainerDef());

    const dbcontainer = this.taskDef.addContainer('superset-db-container', this.postgresContainerDef());

    dbcontainer.addMountPoints({
      readOnly: false,
      containerPath: '/var/lib/postgresql/data',
      sourceVolume: 'db_home',
    });
    dbcontainer.addContainerDependencies({
      container: initContainer,
      condition: ContainerDependencyCondition.SUCCESS,
    });

    this.service = this.postgresFargateService();
  }

  private postgresFargateService(): IService {
    const dbservice = new aws_ecs.FargateService(this.scope, 'superset-dbservice', <FargateServiceProps>{
      platformVersion: FargatePlatformVersion.VERSION1_4,
      propagateTags: PropagatedTagSource.SERVICE,
      cluster: this.cluster,
      serviceName: 'superset-postgres-service',
      deploymentController: {
        type: 'ECS',
      },
      desiredCount: 1,
      maxHealthyPercent: 200,
      minHealthyPercent: 100,
      securityGroups: [this.securityGroup],
      assignPublicIp: true,
      vpcSubnets: {
        subnets: this.subnets,
      },
      taskDefinition: this.taskDef,
    });
    dbservice.associateCloudMapService({
      service: this.serviceEntry,
    });
    Tags.of(dbservice).add('com.docker.compose.project', this.cluster.clusterName);
    Tags.of(dbservice).add('com.docker.compose.service', 'db');
    return dbservice;
  }

  private initContainerDef(): ContainerDefinitionOptions {
    return {
      containerName: 'Db_ResolvConf_InitContainer',
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

  private postgresContainerDef(): ContainerDefinitionOptions {
    return <ContainerDefinitionOptions>{
      containerName: 'db',
      image: ContainerImage.fromRegistry('docker.io/library/postgres:14@sha256:cf3b0cf1dde2a82542e4b9de7f3ad058fdc819dea6499007035b838542b0bd5e'),
      essential: true,
      logging: LogDriver.awsLogs({
        logGroup: this.logGroup,
        streamPrefix: this.clusterName,
      }),
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
      portMappings: [{
        containerPort: 5432,
        hostPort: 5432,
        protocol: Protocol.TCP,
      }],
    };
  }

  private serviceRegistry(): aws_servicediscovery.Service {
    return new aws_servicediscovery.Service(this.scope, 'superset-db-discovery-entry', <ServiceProps>{
      description: '"db" service discovery entry in Cloud Map',
      name: 'db',
      namespace: this.namespace,
      customHealthCheck: {
        failureThreshold: 1,
      },
      routingPolicy: RoutingPolicy.MULTIVALUE,
      dnsTtl: Duration.seconds(60),
      dnsRecordType: DnsRecordType.A,
    });
  }

  private dbHomeFileSystem(): [aws_efs.FileSystem, aws_efs.AccessPoint] {
    const dbHomeFilesystem = new aws_efs.FileSystem(this.scope, 'superset-postgres-fs', <FileSystemProps> {
      encrypted: true,
      removalPolicy: RemovalPolicy.DESTROY,
      vpc: this.vpc,
      securityGroup: this.securityGroup,
    });
    Tags.of(dbHomeFilesystem).add('com.docker.compose.project', this.clusterName);
    Tags.of(dbHomeFilesystem).add('com.docker.compose.volume', 'db_home');
    Tags.of(dbHomeFilesystem).add('Name', `${this.clusterName}_db_home`);

    const dbHomeAccessPoint = new aws_efs.AccessPoint(this.scope, 'superset-db-accesspoint', <AccessPointProps>{
      fileSystem: dbHomeFilesystem,
      // createAcl: {
      //   ownerUid: '1000',
      //   ownerGid: '1000',
      //   permissions: '755',
      // },
      // posixUser: {
      //   uid: '1000',
      //   gid: '1000',
      // },
    });
    Tags.of(dbHomeAccessPoint).add('com.docker.compose.project', this.clusterName);
    Tags.of(dbHomeAccessPoint).add('com.docker.compose.volume', 'db_home');
    Tags.of(dbHomeAccessPoint).add('Name', `${this.clusterName}_db_home`);

    // for (let id in this.subnets) {
    //   new CfnMountTarget(this.scope, `superset-db-mount-target-${id}`, {
    //     fileSystemId: dbHomeFilesystem.fileSystemId,
    //     securityGroups: [this.securityGroup.securityGroupId],
    //     subnetId: this.subnets[id].subnetId,
    //   });
    // }

    return [dbHomeFilesystem, dbHomeAccessPoint];
  }

  private getDBExecutionRole(): aws_iam.IRole {
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
    const dbExecutionRole = new aws_iam.Role(this.scope, 'superset-db-execrole', {
      assumedBy: principal,
    });
    dbExecutionRole.addManagedPolicy({ managedPolicyArn: `arn:${this.partition}:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy` });
    dbExecutionRole.addManagedPolicy({ managedPolicyArn: `arn:${this.partition}:iam::aws:policy/AmazonEC2ContainerRegistryReadOnly` });
    Tags.of(dbExecutionRole).add('com.docker.compose.project', this.clusterName);
    Tags.of(dbExecutionRole).add('com.docker.compose.service', 'db');
    return dbExecutionRole;
  }

  private getDBTaskRole(): aws_iam.IRole {
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
    const dbTaskRole = new aws_iam.Role(this.scope, 'superset-db-taskrole', {
      assumedBy: principal,
    });
    dbTaskRole.addToPolicy(new PolicyStatement(
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
    Tags.of(dbTaskRole).add('com.docker.compose.project', this.clusterName);
    Tags.of(dbTaskRole).add('com.docker.compose.service', 'db');
    return dbTaskRole;
  }

  private dbTaskDef() {
    return new aws_ecs.FargateTaskDefinition(this.scope, 'superset-db-task-def', <FargateTaskDefinitionProps>{
      cpu: 256,
      family: `${this.clusterName}-db`,
      memoryLimitMiB: 512,
      volumes: [
        {
          name: 'db_home',
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
}