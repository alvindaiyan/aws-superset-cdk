import { aws_ec2, Tags } from 'aws-cdk-lib';
import { SecurityGroupProps } from 'aws-cdk-lib/aws-ec2';
import { Construct } from 'constructs';


export class SecurityGroups {
  public readonly defaultSecurityGroup: aws_ec2.SecurityGroup;
  constructor(scope: Construct, myVpc: aws_ec2.IVpc, clusterName: string) {
    this.defaultSecurityGroup = new aws_ec2.SecurityGroup(scope, 'superset-default-security-group', <SecurityGroupProps>{
      description: 'Security group for default network.',
      vpc: myVpc,
    });
    Tags.of(this.defaultSecurityGroup).add('com.docker.compose.project', clusterName);
    Tags.of(this.defaultSecurityGroup).add('com.docker.compose.network', `${clusterName}_default`);
    this.defaultSecurityGroup.addIngressRule(aws_ec2.Peer.anyIpv4(), aws_ec2.Port.tcp(5432), 'db:5432/tcp on default network.');
    this.defaultSecurityGroup.addIngressRule(aws_ec2.Peer.anyIpv4(), aws_ec2.Port.tcp(6379), 'redis:6379/tcp on default network.');
    this.defaultSecurityGroup.addIngressRule(aws_ec2.Peer.anyIpv4(), aws_ec2.Port.tcp(8088), 'superset:8088/tcp on default network.');
    this.defaultSecurityGroup.addIngressRule(this.defaultSecurityGroup, aws_ec2.Port.allTraffic(), 'Allow communication within network default.');
  }
}