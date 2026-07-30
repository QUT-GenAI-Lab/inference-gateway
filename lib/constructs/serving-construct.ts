import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import { Construct } from "constructs";
import * as apigateway from "aws-cdk-lib/aws-apigateway";
import * as acm from "aws-cdk-lib/aws-certificatemanager";
import * as cdk from "aws-cdk-lib/core";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";

/**
 * ServingConstruct is a CDK construct that sets up an API Gateway to route requests to a given Lambda function. It also configures API key-based authentication and usage plans for rate limiting and quotas.
 *
 * To complete this step, a manual DNS validation will be required for the ACM certificate, as well as adding a CNAME record to the DNS provider for the custom domain:
 * - ACM Certificate Validation: During deployment, an ACM certificate will be created for the custom domain. Since we are not using Route53 for DNS management, you will need to manually validate the certificate using DNS validation. Look for a "AWS::CertificateManager::Certificate" resource in the CloudFormation stack outputs, which will provide the CNAME record details (name and value) that need to be added to your DNS provider. This step is necessary to prove ownership of the domain and allow ACM to issue the certificate.
 * -
 *
 * @param scope - The scope in which this construct is defined.
 * @param id - The ID of this construct.
 * @param fn - The Lambda function to integrate with the API Gateway.
 */
export class ServingConstruct extends Construct {
  public readonly api: apigateway.RestApi;
  public readonly apiKey: apigateway.IApiKeyRef;
  public readonly usagePlan: apigateway.UsagePlan;
  public readonly domainName: apigateway.DomainName;
  public readonly widgetKeySecret: secretsmanager.ISecret;
  public readonly widgetApiKey: apigateway.IApiKeyRef;
  public readonly widgetUsagePlan: apigateway.UsagePlan;
  public readonly DOMAIN_NAME = "inference.genai-arcade.net" as const;

  constructor(scope: Construct, id: string, fn: NodejsFunction) {
    super(scope, id);

    this.api = new apigateway.RestApi(this, "InferenceGatewayApi", {
      deployOptions: { stageName: "prod" },
      binaryMediaTypes: ["image/jpeg", "image/png"],
      // TODO: Customize CORS settings as needed for production use.
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: apigateway.Cors.ALL_METHODS,
        allowHeaders: ["*"],
      },
    });

    const integration = new apigateway.LambdaIntegration(fn, {
      proxy: true,
    });

    this.api.root.addMethod("ANY", integration, {
      apiKeyRequired: true,
    });

    this.api.root.addProxy({
      defaultIntegration: integration,
      anyMethod: true,
      defaultMethodOptions: {
        apiKeyRequired: true,
      },
    });

    this.apiKey = this.api.addApiKey("InferenceGatewayApiKey", {
      apiKeyName: "inference-gateway-client-key",
    });

    // ---------- Set up usage plan for rate limiting and quotas ----------

    this.usagePlan = this.api.addUsagePlan("InferenceGatewayUsagePlan", {
      name: "InferenceGatewayUsagePlan",
      throttle: {
        rateLimit: 10,
        burstLimit: 20,
      },
      quota: {
        limit: 10000,
        period: apigateway.Period.MONTH,
      },
    });

    this.usagePlan.addApiKey(this.apiKey);

    this.usagePlan.addApiStage({
      stage: this.api.deploymentStage,
    });

    // ---------- Widget backend API key (sourced from Secrets Manager) ----------

    this.widgetKeySecret = new secretsmanager.Secret(this, "WidgetGatewayKeySecret", {
      secretName: "genai-arcade/widgets/gateway-api-key",
      description:
        "API key value used by widget Lambdas to call the inference gateway.",
      generateSecretString: {
        passwordLength: 40,
        excludePunctuation: true,
        includeSpace: false,
        requireEachIncludedType: false,
      },
    });

    this.widgetApiKey = this.api.addApiKey("WidgetGatewayApiKey", {
      apiKeyName: "widgets-to-inference-gateway-key",
      value: this.widgetKeySecret.secretValue.unsafeUnwrap(),
    });

    this.widgetUsagePlan = this.api.addUsagePlan("WidgetGatewayUsagePlan", {
      name: "WidgetGatewayUsagePlan",
      throttle: {
        rateLimit: 100,
        burstLimit: 200,
      },
    });

    this.widgetUsagePlan.addApiKey(this.widgetApiKey);

    this.widgetUsagePlan.addApiStage({
      stage: this.api.deploymentStage,
    });

    // ---------- Set up custom domain with ACM certificate ----------

    const cert = new acm.Certificate(this, "InferenceGatewayCertificate", {
      domainName: this.DOMAIN_NAME,
      // Since we don't use Route53 for DNS management, we need to manually validate the certificate using DNS validation. This will require adding a CNAME record to the DNS provider for the domain.
      validation: acm.CertificateValidation.fromDns(),
    });

    this.domainName = new apigateway.DomainName(
      this,
      "InferenceGatewayDomain",
      {
        domainName: this.DOMAIN_NAME,
        certificate: cert,
        endpointType: apigateway.EndpointType.REGIONAL,
        securityPolicy: apigateway.SecurityPolicy.TLS_1_2,
      },
    );

    new apigateway.BasePathMapping(this, "InferenceGatewayBasePathMapping", {
      domainName: this.domainName,
      restApi: this.api,
      stage: this.api.deploymentStage,
    });

    // ---------- Cdk outputs for API endpoint and API key ----------
    new cdk.CfnOutput(this, "ApiGatewayDefaultUrl", {
      value: this.api.url,
    });

    new cdk.CfnOutput(this, "CustomDomainName", {
      value: this.domainName.domainName,
    });

    new cdk.CfnOutput(this, "ApiGatewayRegionalDomainName", {
      value: this.domainName.domainNameAliasDomainName,
    });

    new cdk.CfnOutput(this, "ApiKeyId", {
      value: this.apiKey.apiKeyRef.apiKeyId,
    });

    new cdk.CfnOutput(this, "WidgetGatewaySecretName", {
      value: this.widgetKeySecret.secretName,
    });

    new cdk.CfnOutput(this, "WidgetGatewaySecretArn", {
      value: this.widgetKeySecret.secretArn,
    });

    new cdk.CfnOutput(this, "WidgetGatewayApiKeyId", {
      value: this.widgetApiKey.apiKeyRef.apiKeyId,
    });
  }
}
