import { aws_ec2, aws_elasticloadbalancingv2, Tags } from 'aws-cdk-lib';
import { SubnetType } from 'aws-cdk-lib/aws-ec2';
import { NetworkLoadBalancerProps } from 'aws-cdk-lib/aws-elasticloadbalancingv2/lib/nlb/network-load-balancer';
import { Construct } from 'constructs';

export class SupersetNetwork {
  public readonly supersetVpc: aws_ec2.IVpc;
  public readonly publicSubnet1: aws_ec2.ISubnet;
  public readonly publicSubnet2: aws_ec2.ISubnet;
  public readonly privateSubnet1: aws_ec2.ISubnet;
  public readonly privateSubnet2: aws_ec2.ISubnet;
  public readonly nlb: aws_elasticloadbalancingv2.NetworkLoadBalancer;

  constructor(
    scope: Construct,
    availabilityZones: string[],
    clusterName: string,
    vpcId: string,
    publicSubnet1ID: string,
    publicSubnet2ID: string,
    privateSubnet1ID: string,
    privateSubnet2ID: string) {
    // this.supersetVpc = aws_ec2.Vpc.fromLookup(scope, 'superset-default-vpc', {
    //   vpcId: vpcId,
    // });

    this.supersetVpc = aws_ec2.Vpc.fromVpcAttributes(scope, 'superset-default-vpc', {
      availabilityZones: availabilityZones,
      publicSubnetIds: [publicSubnet1ID, publicSubnet2ID],
      privateSubnetIds: [privateSubnet1ID, privateSubnet2ID],
      vpcId: vpcId,

    });

    this.publicSubnet1 = aws_ec2.Subnet.fromSubnetId(scope, 'superset-public-subnet1', publicSubnet1ID);
    this.publicSubnet2 = aws_ec2.Subnet.fromSubnetId(scope, 'superset-public-subnet2', publicSubnet2ID);
    this.privateSubnet1 = aws_ec2.Subnet.fromSubnetId(scope, 'superset-private-subnet1', privateSubnet1ID);
    this.privateSubnet2 = aws_ec2.Subnet.fromSubnetId(scope, 'superset-private-subnet2', privateSubnet2ID);

    // network loadbalancer
    this.nlb = new aws_elasticloadbalancingv2.NetworkLoadBalancer(scope, 'superset-loadbalancer', <NetworkLoadBalancerProps>{
      vpc: this.supersetVpc,
      vpcSubnets: {
        subnetType: SubnetType.PUBLIC,
      },
      // vpcSubnets: this.supersetVpc.publicSubnets,
      internetFacing: true,
      crossZoneEnabled: true,
    });
    Tags.of(this.nlb).add('com.docker.compose.project', clusterName);
  }
}