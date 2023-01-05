import { CfnDashboard } from 'aws-cdk-lib/aws-cloudwatch';
import { ICluster } from 'aws-cdk-lib/aws-ecs';
import { FileSystem } from 'aws-cdk-lib/aws-efs';
import { ILoadBalancerV2 } from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import { LogGroup } from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';

export interface SupersetDashboardParam {
  beatServiceName: string;
  workerServiceName: string;
  cluster: ICluster;
  redisName: string;
  dbName: string;
  nodeService: string;
  supersetService: string;
  region: string;
  supersetFileSystem: FileSystem;
  redisFileSystem: FileSystem;
  postgresFileSystem: FileSystem;
  availabilityZone: string;
  targetGroupFullName: string;
  lb: ILoadBalancerV2;
  logGroup: LogGroup;
}

export class SupersetDashboard {

  constructor(scope: Construct, params: SupersetDashboardParam) {
    new CfnDashboard(scope, 'superset-cloudwatch-dashboard', {
      dashboardBody: `
{
    "widgets": [
        {
            "height": 6,
            "width": 12,
            "y": 0,
            "x": 0,
            "type": "metric",
            "properties": {
                "metrics": [
                    [ "AWS/ECS", "MemoryUtilization", "ServiceName", "${params.beatServiceName}", "ClusterName", "${params.cluster.clusterName}", { "stat": "Average" } ],
                    [ "...", "${params.workerServiceName}", ".", ".", { "stat": "Average" } ],
                    [ "...", "${params.redisName}", ".", ".", { "stat": "Average" } ],
                    [ "...", "${params.dbName}", ".", ".", { "stat": "Average" } ],
                    [ "...", "${params.nodeService}", ".", ".", { "stat": "Average" } ],
                    [ "...", "${params.supersetService}", ".", ".", { "stat": "Average" } ]
                ],
                "view": "timeSeries",
                "stacked": false,
                "region": "${params.region}",
                "period": 300,
                "setPeriodToTimeRange": true,
                "legend": {
                    "position": "bottom"
                },
                "yAxis": {
                    "left": {
                        "label": "",
                        "showUnits": true
                    }
                },
                "title": "MemoryUtilization-Services"
            }
        },
        {
            "height": 6,
            "width": 12,
            "y": 6,
            "x": 0,
            "type": "metric",
            "properties": {
                "metrics": [
                    [ "AWS/ECS", "CPUUtilization", "ServiceName", "${params.workerServiceName}", "ClusterName", "${params.cluster.clusterName}" ],
                    [ "...", "${params.beatServiceName}", ".", "." ],
                    [ "...", "${params.redisName}", ".", "." ],
                    [ "...", "${params.dbName}", ".", "." ],
                    [ "...", "${params.nodeService}", ".", "." ],
                    [ "...", "${params.supersetService}", ".", "." ]
                ],
                "view": "timeSeries",
                "stacked": false,
                "region": "${params.region}",
                "period": 300,
                "title": "CPUUtilization-Services"
            }
        },
        {
            "height": 6,
            "width": 12,
            "y": 0,
            "x": 12,
            "type": "metric",
            "properties": {
                "metrics": [
                    [ "AWS/ECS", "CPUUtilization", "ServiceName", "${params.workerServiceName}", "ClusterName", "${params.cluster.clusterName}", { "stat": "SampleCount", "yAxis": "left", "period": 60 } ],
                    [ "...", "${params.nodeService}", ".", ".", { "period": 60, "stat": "SampleCount" } ],
                    [ "...", "${params.dbName}", ".", ".", { "period": 60, "stat": "SampleCount" } ],
                    [ "...", "${params.redisName}", ".", ".", { "period": 60, "stat": "SampleCount" } ],
                    [ "...", "${params.supersetService}", ".", ".", { "period": 60, "stat": "SampleCount" } ],
                    [ "...", "${params.beatServiceName}", ".", ".", { "period": 60, "stat": "SampleCount" } ]
                ],
                "view": "singleValue",
                "region": "${params.region}",
                "period": 300,
                "stacked": false,
                "setPeriodToTimeRange": true,
                "title": "RUNNING task count"
            }
        },
        {
            "height": 6,
            "width": 12,
            "y": 6,
            "x": 12,
            "type": "metric",
            "properties": {
                "metrics": [
                    [ "AWS/EFS", "PercentIOLimit", "FileSystemId", "${params.postgresFileSystem.fileSystemId}", { "id": "m1", "visible": false } ],
                    [ "...", "${params.redisFileSystem.fileSystemId}", { "id": "m2", "visible": false } ],
                    [ "...", "${params.supersetFileSystem.fileSystemId}", { "id": "m3", "visible": false } ],
                    [ { "expression": "100*m1", "label": "${params.postgresFileSystem.fileSystemId}", "id": "e1" } ],
                    [ { "expression": "100*(m2)", "label": "${params.redisFileSystem.fileSystemId}", "id": "e2" } ],
                    [ { "expression": "100*(m3)", "label": "${params.supersetFileSystem.fileSystemId}", "id": "e3" } ]
                ],
                "view": "timeSeries",
                "stacked": false,
                "region": "${params.region}",
                "title": "EFS IO Utilization (%)",
                "period": 300
            }
        },
        {
            "height": 6,
            "width": 12,
            "y": 12,
            "x": 12,
            "type": "metric",
            "properties": {
                "metrics": [
                    [ { "expression": "(m1/1048576)/PERIOD(m1)", "label": "Expression1", "id": "e1", "visible": false, "region": "${params.region}" } ],
                    [ { "expression": "m2/1048576", "label": "Expression2", "id": "e2", "visible": false, "region": "${params.region}" } ],
                    [ { "expression": "e2-e1", "label": "Expression3", "id": "e3", "visible": false, "region": "${params.region}" } ],
                    [ { "expression": "((e1)*100)/(e2)", "label": "Throughput Utilization(%)-DbhomeFilesystem ", "id": "e4", "region": "${params.region}" } ],
                    [ "AWS/EFS", "MeteredIOBytes", "FileSystemId", "${params.postgresFileSystem.fileSystemId}", { "id": "m1", "period": 60, "visible": false, "region": "${params.region}" } ],
                    [ "AWS/EFS", "PermittedThroughput", "FileSystemId", "${params.postgresFileSystem.fileSystemId}", { "id": "m2", "period": 60, "visible": false, "region": "${params.region}" } ]
                ],
                "view": "timeSeries",
                "stacked": false,
                "region": "${params.region}",
                "stat": "Sum",
                "period": 300,
                "title": "EFS Throughput Utilization (%)",
                "annotations": {
                    "horizontal": [
                        {
                            "visible": true,
                            "color": "#d13212",
                            "label": "Utilization Warning",
                            "value": 75,
                            "fill": "above",
                            "yAxis": "left"
                        }
                    ]
                },
                "yAxis": {
                    "left": {
                        "max": 100
                    }
                }
            }
        },
        {
            "height": 6,
            "width": 12,
            "y": 12,
            "x": 0,
            "type": "metric",
            "properties": {
                "metrics": [
                    [ "AWS/NetworkELB", "HealthyHostCount", "TargetGroup", "${params.targetGroupFullName}", "AvailabilityZone", "${params.availabilityZone}", "LoadBalancer", "${params.lb}", { "stat": "Minimum" } ],
                    [ ".", "UnHealthyHostCount", ".", ".", ".", ".", ".", ".", { "stat": "Maximum" } ],
                    [ ".", "HealthyHostCount", ".", ".", ".", "${params.region}", ".", ".", { "stat": "Minimum" } ],
                    [ ".", "UnHealthyHostCount", ".", ".", ".", ".", ".", ".", { "stat": "Maximum" } ]
                ],
                "view": "timeSeries",
                "stacked": true,
                "region": "${params.region}",
                "title": "Healthy/UnHealthyHostCount",
                "period": 300
            }
        },
        {
            "height": 6,
            "width": 24,
            "y": 18,
            "x": 0,
            "type": "log",
            "properties": {
                "query": "SOURCE '${params.logGroup}' | fields @timestamp, @message\\n| sort @timestamp desc\\n| limit 20",
                "region": "${params.region}",
                "stacked": false,
                "view": "table"
            }
        },
        {
            "height": 6,
            "width": 24,
            "y": 24,
            "x": 0,
            "type": "log",
            "properties": {
                "query": "SOURCE '${params.logGroup}' | fields @timestamp, @message\\n| filter @message like /Exception/\\n| sort @timestamp desc",
                "region": "${params.region}",
                "stacked": false,
                "title": "Log group: Filter with exceptions",
                "view": "table"
            }
        }
    ]
}
      `,
    });
  }
}