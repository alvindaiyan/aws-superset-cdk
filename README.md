# TL;DR

This is a complement for project at [quickstart-apache-superset](https://github.com/aws-quickstart/quickstart-apache-superset).
Because the original quickstart-apache-superset project is written in Cloudformation and it's hard to read and maintain.

# What is apache superset

Please checkout the official website: [https://superset.apache.org/](https://superset.apache.org/).

# How to run this project

## Use cdk

1. checkout the project by git.
2. install projen
    ``` shell
   npm install projen@latest
    ```
3. run 
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
   --parameters superset-cdk-dev:supersetparamclustername=supersetOnAWS \
   --parameters superset-cdk-dev:supersetsecretkey=your-superset-key
    ```

## Configuring Superset through superset_config.py

For configuration option please refer to the official website: [https://superset.apache.org/docs/installation/configuring-superset](https://superset.apache.org/docs/installation/configuring-superset)

After deploying the stack you can create a custom superset_config.py in /app/superset_home. 

1. connect to the superset container
    ``` shell
   aws ecs execute-command --cluster [cluster-name] --task [task-id] --container superset --command "/bin/bash" --interactive
    ```
2. copy the content you want for the superset_config.py to your clipboard (cmd+C | ctrl+C)
3. create a new config file in /app/superset_home
    ``` shell
   cd /app/superset_home && cat > superset_config.py
    ```
4. paste the clipboard content (cmd+V | ctrl+V)
5. end file input (cmd+D)
6. through AWS console restart the container