import {
  aws_ec2,
  aws_ecs,
  aws_rds,
  aws_servicediscovery,
  Duration, IResource,
  SecretValue,

} from 'aws-cdk-lib';
import { ISubnet, IVpc, SecurityGroup } from 'aws-cdk-lib/aws-ec2';
import { LogGroup } from 'aws-cdk-lib/aws-logs';
import { CnameInstanceBaseProps, DnsRecordType, ServiceProps } from 'aws-cdk-lib/aws-servicediscovery';
import { Construct } from 'constructs';

export interface SupersetDatabaseParam {
  serviceNamespace: aws_servicediscovery.PrivateDnsNamespace;
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

export class SupersetDatabaseAurora {
  public readonly service: IResource;
  //
  // private readonly taskDef: aws_ecs.TaskDefinition;
  private readonly namespace: aws_servicediscovery.PrivateDnsNamespace;
  private readonly scope: Construct;
  private readonly securityGroup: SecurityGroup;
  private readonly subnets: ISubnet[];
  private readonly serviceEntry: aws_servicediscovery.Service;
  private readonly vpc: IVpc;

  constructor(scope: Construct, params: SupersetDatabaseParam) {
    this.namespace = params.serviceNamespace;
    this.scope = scope;
    this.securityGroup = params.securityGroup;
    this.subnets = params.subnets;
    this.vpc = params.vpc;


    this.serviceEntry = this.serviceRegistry();
    this.service = this.postgresRdsInstance(scope, 'superset-postgres-db');
  }

  private postgresRdsInstance(scope: Construct, id: string): IResource {
    const db = new aws_rds.DatabaseCluster(scope, id, {
      engine: aws_rds.DatabaseClusterEngine.auroraPostgres({
        version: aws_rds.AuroraPostgresEngineVersion.VER_14_5,
      }),

      credentials: aws_rds.Credentials.fromPassword('superset', SecretValue.unsafePlainText('superset')),
      defaultDatabaseName: 'superset',
      instanceProps: {
        vpc: this.vpc,
        instanceType: aws_ec2.InstanceType.of(aws_ec2.InstanceClass.R6G, aws_ec2.InstanceSize.LARGE),
        securityGroups: [this.securityGroup],
        vpcSubnets: {
          // subnetType: aws_ec2.SubnetType.PRIVATE_ISOLATED,
          subnets: this.subnets,
        },
      },
    });

    this.serviceEntry.registerCnameInstance(id, <CnameInstanceBaseProps>{
      instanceId: db.clusterIdentifier,
      instanceCname: db.clusterEndpoint.hostname,
      customAttributes: {
        AWS_INSTANCE_PORT: `${db.clusterEndpoint.port}`,
      },
    });
    return db;
  }

  private serviceRegistry(): aws_servicediscovery.Service {
    return new aws_servicediscovery.Service(this.scope, 'superset-db-discovery-entry', <ServiceProps>{
      description: '"db" service discovery entry in Cloud Map',
      name: 'db',
      namespace: this.namespace,
      // customHealthCheck: {
      //   failureThreshold: 1,
      // },
      // routingPolicy: RoutingPolicy.MULTIVALUE,
      dnsTtl: Duration.seconds(60),
      dnsRecordType: DnsRecordType.CNAME,
    });
  }
}