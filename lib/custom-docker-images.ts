import * as cdk from "aws-cdk-lib/core";
import { Construct } from "constructs";
import * as ecr_assets from "aws-cdk-lib/aws-ecr-assets";

const DOCKER_IMAGES = [
  "pytorch-inference-gpu-codecarbon",
  "pytorch-inference-gpu-diffusers-codecarbon",
] as const;

type DockerImageName = (typeof DOCKER_IMAGES)[number];

export type CustomDockerImageUris = Record<DockerImageName, string>;

function getDockerImagePath(imageName: string): string {
  return `lib/docker/${imageName}`;
}

export class CustomDockerImagesStack extends Construct {
  private _images: Record<DockerImageName, ecr_assets.DockerImageAsset> =
    {} as Record<DockerImageName, ecr_assets.DockerImageAsset>;
  imageUrls: CustomDockerImageUris = {} as CustomDockerImageUris;

  constructor(scope: Construct, id: string) {
    super(scope, id);

    for (const imageName of DOCKER_IMAGES) {
      const imagePath = getDockerImagePath(imageName);
      this._images[imageName] = new ecr_assets.DockerImageAsset(
        this,
        `${imageName}-custom-image`,
        {
          directory: imagePath,
        },
      );
    }

    for (const imageName of DOCKER_IMAGES) {
      this.imageUrls[imageName] = this._images[imageName].imageUri;
    }
  }
}
