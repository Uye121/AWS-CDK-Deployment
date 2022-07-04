import { Construct } from 'constructs';
import { Chain, StateMachine, LogLevel, Parallel, Choice } from 'aws-cdk-lib/aws-stepfunctions';
import { LambdaInvoke } from 'aws-cdk-lib/aws-stepfunctions-tasks';
import { LogGroup } from 'aws-cdk-lib/aws-logs';
import {
  SerialSfnProps,
  ISfnObject,
  ISfnChoice,
  ISfnConfig,
  Pass,
} from '../types';
import { RemovalPolicy } from 'aws-cdk-lib';

/**
 * Create simple serial step function workflow with ability to
 * add error handler to each step function task and to
 * overall workflow
 */
export class SerialSfnConstruct extends Construct {
  public readonly stateMachine: StateMachine;

  constructor(scope: Construct, id: string, props: SerialSfnProps) {
    super(scope, id);

    const {
      lambdaFunctions,
      errorHandler,
      stateMachineName,
    } = props;

    if (!lambdaFunctions.length) return;

    let firstFunction = true;
    const definition = new Parallel(this, `paralle-${id}`);
    definition.branch(
      this.chainTasks(lambdaFunctions, firstFunction),
    );

    // Attach overall error handler for the step function if applicable
    if (errorHandler) {
      definition.addCatch(
        new LambdaInvoke(this, errorHandler.name, {
          lambdaFunction: errorHandler.function,
          retryOnServiceExceptions: false,
        }), {
          errors: errorHandler.errors,
          // Return step function error and input parameters
          resultPath: '$.error',
        }
      )
    }

    // Create log group for state machine
    const logGroup = new LogGroup(this, `logGroup-${id}`, {
      logGroupName: `/aws/vendedlogs/states/${stateMachineName}`,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    this.stateMachine = new StateMachine(this, stateMachineName, {
      definition,
      stateMachineName: stateMachineName,
      logs: {
        destination: logGroup,
        level: LogLevel.ALL,
      }
    });
  }

  /**
   * Returns step function task configuration object
   */
  config = (config: ISfnConfig) => ({
    interval: config.retryInterval,
    maxAttempts: config.retryAttempts,
    errors: config.errors,
  });

  /**
   * Recursive function to add tasks to state machine
   * @param lambdaFunctions - Array of step function object or choice object
   * @param first - flag indicating if step function object is first in step function
   * @returns Lambda invocation task or step function task chain
   */
  chainTasks(
    lambdaFunctions: Array<ISfnObject | ISfnChoice>,
    first: boolean,
  ): LambdaInvoke | Chain {
    let task;
    let sfnObject = lambdaFunctions.shift();

    // check if sfn object is in the shape of ISfnChoice
    if (sfnObject && 'choices' in sfnObject) {
      sfnObject = sfnObject as ISfnChoice;
      task = this.addChoice(sfnObject, first);
    } else {
      sfnObject = sfnObject as ISfnObject;
      task = new LambdaInvoke(this, sfnObject.name, {
        lambdaFunction: sfnObject.function,
        inputPath: first ? undefined : '$.Payload',
        retryOnServiceExceptions: false,
      });
      first = false;
      if (sfnObject.config)
        task.addRetry(this.config(sfnObject.config));
    }

    if (lambdaFunctions.length)
      return task.next(this.chainTasks(lambdaFunctions, first));
    else
      return task;
  }

  /**
   * Create step function choice chain
   * @param choice - step function choice object
   * @param first - flag indicating if step function object is first in step function
   * @returns step function task chain
   */
  addChoice(
    choice: ISfnChoice,
    first: boolean,
  ): Chain {
    const res = new Choice(this, choice.choiceName);
    if (!choice.choices.length) return res.afterwards();

    for (const choiceObj of choice.choices) {
      res.when(
        choiceObj.condition,
        ('endStates' in choiceObj.functions!)
          ? choice.defaultFunctions as Pass
          : this.chainTasks(
            choice.defaultFunctions as Array<ISfnObject>,
            first,
          ),
      );
    }

    return res.afterwards();
  }
}
