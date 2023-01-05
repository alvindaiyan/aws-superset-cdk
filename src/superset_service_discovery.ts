import { aws_ec2, aws_servicediscovery } from 'aws-cdk-lib';
import { PrivateDnsNamespaceProps } from 'aws-cdk-lib/aws-servicediscovery';
import { Construct } from 'constructs';


export class SupersetServiceDiscovery {
  public readonly namespace: aws_servicediscovery.INamespace;

  constructor(scope: Construct, clusterName:string, vpc: aws_ec2.IVpc) {
    // cloudmap service discovery
    this.namespace = new aws_servicediscovery.PrivateDnsNamespace(scope, 'superset-service-discovery', <PrivateDnsNamespaceProps>{
      name: `${clusterName}.local`,
      description: 'Service map for Docker compose project.',
      vpc: vpc,
    });
  }
}