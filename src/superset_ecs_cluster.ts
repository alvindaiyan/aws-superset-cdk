import { aws_ecs, Tags } from 'aws-cdk-lib';
import { IVpc } from 'aws-cdk-lib/aws-ec2';
import { ClusterProps } from 'aws-cdk-lib/aws-ecs';
import { Construct } from 'constructs';

export class SupersetEcsCluster {
  public readonly cluster: aws_ecs.ICluster;

  constructor(scope: Construct, clusterName: string, vpc: IVpc) {
    // ecs cluster
    this.cluster = new aws_ecs.Cluster(scope, 'superset-ecs-cluster', <ClusterProps>{
      clusterName: clusterName,
      vpc: vpc,
    });
    Tags.of(this.cluster).add('com.docker.compose.project', clusterName);
  }
}