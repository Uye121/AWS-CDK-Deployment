#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { AwsCdkDeploymentStack } from '../lib/aws-cdk-deployment-stack';

const app = new cdk.App();
new AwsCdkDeploymentStack(app, 'AwsCdkDeploymentStack', {
  // env: { account: '123456789012', region: 'us-east-1' },
});
