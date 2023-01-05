# TL;DR

This is a complement for project at [quickstart-apache-superset](https://github.com/aws-quickstart/quickstart-apache-superset).
Because the original quickstart-apache-superset project is written in Cloudformation and it's hard to read and maintain.

# What is apache superset

Please checkout the official website: [https://superset.apache.org/](https://superset.apache.org/).

# How to run this project

## Use cdk

1. checkout the project by git.
2. run 
    ``` shell
   npx projen deploy superset-cdk-dev \                                                                                                                                                      
   --parameters superset-cdk-dev:supersetusername=your-user-name \
   --parameters superset-cdk-dev:supersetpassword=your-password \
   --parameters superset-cdk-dev:supersetexample=yes \
   --parameters superset-cdk-dev:supersetparamvpcid=the-existing-vpc-id \
   --parameters superset-cdk-dev:supersetparampublicsubnet1=the-existing-public-subnet \
   --parameters superset-cdk-dev:supersetparampublicsubnet2=the-existing-public-subnet \
   --parameters superset-cdk-dev:supersetparamprivatesubnet1=the-existing-private-subnet \
   --parameters superset-cdk-dev:supersetparamprivatesubnet2=the-existing-private-subnet \
   --parameters superset-cdk-dev:supersetparamclustername=supersetOnAWS
    ```