import { CfnParameter, CfnParameterProps, Stack } from 'aws-cdk-lib';
import { Construct } from 'constructs';

export interface ParameterSummary {
  username: CfnParameter;
  userPassword: CfnParameter;
  withExample: CfnParameter;
  installProphet: CfnParameter;
  vpcID: CfnParameter;
  publicSubnet1ID: CfnParameter;
  publicSubnet2ID: CfnParameter;
  privateSubnet1AID: CfnParameter;
  privateSubnet2AID: CfnParameter;
  clusterName: CfnParameter;
}

export class Parameters {
  public static templateParameterGrouping(stack: Stack, parameters: ParameterSummary) {
    stack.templateOptions.metadata = {
      'AWS::CloudFormation::Interface': {
        ParameterGroups: [
          {
            Label: {
              default: 'Account configuration',
            },
            Parameters: [
              parameters.username.logicalId,
              parameters.userPassword.logicalId,
              parameters.withExample.logicalId,
              parameters.installProphet.logicalId,
              parameters.clusterName.logicalId,
            ],
          },
          {
            Label: {
              default: 'Network configuration',
            },
            Parameters: [
              parameters.vpcID.logicalId,
              parameters.publicSubnet1ID.logicalId,
              parameters.publicSubnet1ID.logicalId,
              parameters.privateSubnet1AID.logicalId,
              parameters.privateSubnet2AID.logicalId,
            ],
          },
        ],
        ParameterLabels: {
          [parameters.username.logicalId]: {
            default: 'Initial Superset user Name',
          },
          [parameters.userPassword.logicalId]: {
            default: 'Initial Superset password',
          },
          [parameters.withExample.logicalId]: {
            default: 'Populate example dashboard',
          },
          [parameters.installProphet.logicalId]: {
            default: 'Install Prophet library',
          },
          [parameters.vpcID.logicalId]: {
            default: 'vpc ID',
          },
          [parameters.publicSubnet1ID.logicalId]: {
            default: 'Public subnet for Availability Zone 1',
          },
          [parameters.publicSubnet2ID.logicalId]: {
            default: 'Public subnet for Availability Zone 2',
          },
          [parameters.privateSubnet1AID.logicalId]: {
            default: 'Private subnet for Availability Zone 1',
          },
          [parameters.privateSubnet2AID.logicalId]: {
            default: 'Private subnet for Availability Zone 2',
          },
          [parameters.clusterName.logicalId]: {
            default: 'Amazon ECS Cluster Name',
          },
        },
      },
    };
  }

  private static constructParameters(scope: Construct): ParameterSummary {
    return {
      username: new CfnParameter(scope, 'superset-username', <CfnParameterProps>{
        type: 'String',
        description: 'Superset user name.',
      }),
      userPassword: new CfnParameter(scope, 'superset-password', <CfnParameterProps>{
        type: 'String',
        noEcho: true,
        description: 'Description: Superset password. A strict password policy is recommended.',
      }),
      withExample: new CfnParameter(scope, 'superset-example', <CfnParameterProps>{
        type: 'String',
        allowedValues: ['yes', 'no'],
        default: 'no',
        description: 'Enables or disables populating the dashboard example. Setting this parameter to "yes" populates the dashboard example.',
      }),
      installProphet: new CfnParameter(scope, 'superset-prophet', <CfnParameterProps>{
        type: 'String',
        allowedValues: ['yes', 'no'],
        description: 'Enables or disables Prophet library installation for Forecasting Analytics. Setting this parameter to "yes" installs Prophet to enable Forecasting Analytics.\'',
        default: 'no',
      }),
      vpcID: new CfnParameter(scope, 'superset-param-vpcid', <CfnParameterProps>{
        type: 'AWS::EC2::VPC::Id',
        description: 'VPC ID.',
      }),
      publicSubnet1ID: new CfnParameter(scope, 'superset-param-public-subnet1', <CfnParameterProps>{
        type: 'AWS::EC2::Subnet::Id',
        description: 'Public subnet for Availability Zone 1.',
      }),
      publicSubnet2ID: new CfnParameter(scope, 'superset-param-public-subnet2', <CfnParameterProps>{
        type: 'AWS::EC2::Subnet::Id',
        description: 'Public subnet for Availability Zone 2.',
      }),
      privateSubnet1AID: new CfnParameter(scope, 'superset-param-private-subnet1', <CfnParameterProps>{
        type: 'AWS::EC2::Subnet::Id',
        description: 'Private subnet for Availability Zone 1.',
      }),
      privateSubnet2AID: new CfnParameter(scope, 'superset-param-private-subnet2', <CfnParameterProps>{
        type: 'AWS::EC2::Subnet::Id',
        description: 'Private subnet for Availability Zone 2.',
      }),
      clusterName: new CfnParameter(scope, 'superset-param-cluster-name', <CfnParameterProps>{
        type: 'String',
        description: 'Name of the Amazon ECS cluster.',
        default: 'supersetOnAWS',
      }),
    };
  }

  public readonly allParameters: ParameterSummary;

  constructor(scope: Construct) {
    this.allParameters = Parameters.constructParameters(scope);
  }
}