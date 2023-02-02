
import {
  App,
  Stack,
  StackProps,
} from 'aws-cdk-lib';
import * as cdk from 'aws-cdk-lib';
import { LogGroup, LogGroupProps } from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';
import { Parameters } from './parameters';
import { SecurityGroups } from './security_groups';
import { SupersetCelery } from './superset_celery';
import { SupersetDashboard } from './superset_dashboard';
import { SupersetDatabase, SupersetDatabaseParam } from './superset_database';
import { SupersetEcsCluster } from './superset_ecs_cluster';
import { SupersetInitService } from './superset_init_service';
import { SupersetNetwork } from './superset_network';
import { SupersetNodeService } from './superset_node_service';
import { SupersetRedis, SupersetRedisParam } from './superset_redis';
import { SupersetService, SupersetServiceParam } from './superset_service';
import { SupersetServiceDiscovery } from './superset_service_discovery';
import { SupersetWorkerService } from './superset_worker_service';

export class MyStack extends Stack {

  constructor(scope: Construct, id: string, props: StackProps = {}) {
    super(scope, id, props);
    const parameters = new Parameters(this);
    Parameters.templateParameterGrouping(this, parameters.allParameters);

    const supersetNetwork = new SupersetNetwork(
      this,
      [this.availabilityZones[0], this.availabilityZones[1]],
      parameters.allParameters.clusterName.valueAsString,
      parameters.allParameters.vpcID.valueAsString,
      parameters.allParameters.publicSubnet1ID.valueAsString,
      parameters.allParameters.publicSubnet2ID.valueAsString,
      parameters.allParameters.privateSubnet1AID.valueAsString,
      parameters.allParameters.privateSubnet2AID.valueAsString,
    );

    // service discovery
    const serviceDiscovery = new SupersetServiceDiscovery(this, parameters.allParameters.clusterName.valueAsString, supersetNetwork.supersetVpc);

    // security group
    const securityGroups = new SecurityGroups(this, supersetNetwork.supersetVpc, parameters.allParameters.clusterName.valueAsString);

    // ecs cluster
    const supersetCluster = new SupersetEcsCluster(this, parameters.allParameters.clusterName.valueAsString, supersetNetwork.supersetVpc);

    // log setup
    const logGroup = this.logGroup(parameters.allParameters.clusterName.valueAsString);

    const dbService = new SupersetDatabase(this, <SupersetDatabaseParam>{
      serviceNamespace: serviceDiscovery.namespace,
      ecsCluster: supersetCluster.cluster,
      partition: this.partition,
      region: this.region,
      logGroup: logGroup,
      withExample: parameters.allParameters.withExample.valueAsString,
      username: parameters.allParameters.username.valueAsString,
      userPassword: parameters.allParameters.userPassword.valueAsString,
      securityGroup: securityGroups.defaultSecurityGroup,
      subnets: [supersetNetwork.privateSubnet1, supersetNetwork.privateSubnet2],
      vpc: supersetNetwork.supersetVpc,
    });

    const redisService = new SupersetRedis(this, <SupersetRedisParam>{
      serviceNamespace: serviceDiscovery.namespace,
      ecsCluster: supersetCluster.cluster,
      partition: this.partition,
      region: this.region,
      logGroup: logGroup,
      securityGroup: securityGroups.defaultSecurityGroup,
      subnets: [supersetNetwork.privateSubnet1, supersetNetwork.privateSubnet2],
      vpc: supersetNetwork.supersetVpc,
    });

    const supersetService = new SupersetService(this, <SupersetServiceParam>{
      namespace: serviceDiscovery.namespace,
      partition: this.partition,
      region: this.region,
      cluster: supersetCluster.cluster,
      subnets: [supersetNetwork.privateSubnet1, supersetNetwork.privateSubnet2],
      securityGroup: securityGroups.defaultSecurityGroup,
      vpc: supersetNetwork.supersetVpc,
      loadbalancer: supersetNetwork.nlb,
      logGroup: logGroup,
      withExample: parameters.allParameters.withExample.valueAsString,
      username: parameters.allParameters.username.valueAsString,
      userPassword: parameters.allParameters.userPassword.valueAsString,
      installProphet: parameters.allParameters.installProphet.valueAsString,
    });
    supersetService.service.node.addDependency(dbService.service, redisService.service);

    const initService = new SupersetInitService(this, {
      partition: this.partition,
      cluster: supersetCluster.cluster,
      supersetSvcFileSystem: supersetService.fileSystem,
      supersetSvcAccessPoint: supersetService.accessPoint,
      securityGroup: securityGroups.defaultSecurityGroup,
      namespace: serviceDiscovery.namespace,
      subnets: [supersetNetwork.privateSubnet1, supersetNetwork.privateSubnet2],
      region: this.region,
      logGroup: logGroup,
      withExample: parameters.allParameters.withExample.valueAsString,
      username: parameters.allParameters.username.valueAsString,
      userPassword: parameters.allParameters.userPassword.valueAsString,
      installProphet: parameters.allParameters.installProphet.valueAsString,
    });
    initService.service.node.addDependency(dbService.service, redisService.service);

    const nodeService = new SupersetNodeService(this, {
      namespace: serviceDiscovery.namespace,
      partition: this.partition,
      region: this.region,
      cluster: supersetCluster.cluster,
      subnets: [supersetNetwork.privateSubnet1, supersetNetwork.privateSubnet2],
      securityGroup: securityGroups.defaultSecurityGroup,
      logGroup: logGroup,
      supersetSvcFileSystem: supersetService.fileSystem,
      supersetSvcAccessPoint: supersetService.accessPoint,
      withExample: parameters.allParameters.withExample.valueAsString,
      username: parameters.allParameters.username.valueAsString,
      userPassword: parameters.allParameters.userPassword.valueAsString,
    });
    nodeService.service.node.addDependency(dbService.service, redisService.service);

    const workerService = new SupersetWorkerService(this, {
      namespace: serviceDiscovery.namespace,
      partition: this.partition,
      region: this.region,
      cluster: supersetCluster.cluster,
      subnets: [supersetNetwork.privateSubnet1, supersetNetwork.privateSubnet2],
      securityGroup: securityGroups.defaultSecurityGroup,
      logGroup: logGroup,
      supersetSvcFileSystem: supersetService.fileSystem,
      supersetSvcAccessPoint: supersetService.accessPoint,
      withExample: parameters.allParameters.withExample.valueAsString,
      username: parameters.allParameters.username.valueAsString,
      userPassword: parameters.allParameters.userPassword.valueAsString,
    });
    workerService.service.node.addDependency(dbService.service, redisService.service);

    const beatService = new SupersetCelery(this, {
      namespace: serviceDiscovery.namespace,
      partition: this.partition,
      region: this.region,
      cluster: supersetCluster.cluster,
      subnets: [supersetNetwork.privateSubnet1, supersetNetwork.privateSubnet2],
      securityGroup: securityGroups.defaultSecurityGroup,
      logGroup: logGroup,
      supersetSvcFileSystem: supersetService.fileSystem,
      supersetSvcAccessPoint: supersetService.accessPoint,
      withExample: parameters.allParameters.withExample.valueAsString,
      username: parameters.allParameters.username.valueAsString,
      userPassword: parameters.allParameters.userPassword.valueAsString,
    });
    beatService.service.node.addDependency(dbService.service, redisService.service);


    new SupersetDashboard(this, {
      beatServiceName: beatService.service.serviceName,
      workerServiceName: workerService.service.serviceName,
      cluster: supersetCluster.cluster,
      redisName: redisService.service.serviceName,
      dbName: dbService.service.serviceName,
      nodeService: nodeService.service.serviceName,
      supersetService: supersetService.service.serviceName,
      region: this.region,
      supersetFileSystem: supersetService.fileSystem,
      redisFileSystem: redisService.fs,
      postgresFileSystem: dbService.fileSystem,
      availabilityZone: supersetNetwork.supersetVpc.availabilityZones[0],
      targetGroupFullName: supersetService.targetGroup.targetGroupFullName,
      lb: supersetService.lb,
      logGroup: logGroup,
    });
  }

  private logGroup(clusterName: string): LogGroup {
    const trimmedStackId = cdk.Fn.select(2, cdk.Fn.split('/', this.stackId));// this.stackId.split('/')[2];
    return new LogGroup(this, 'superset-log-group', <LogGroupProps>{
      logGroupName: `/docker-compose/${clusterName}-${trimmedStackId}`,
    });
  }
}

// for development, use account/region from cdk cli
const devEnv = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION,
};

const app = new App();

new MyStack(app, 'superset-cdk-dev', { env: devEnv });
// new MyStack(app, 'superset-cdk-prod', { env: prodEnv });

app.synth();