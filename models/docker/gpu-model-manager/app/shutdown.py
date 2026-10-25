"""EC2 self-stop helper for the model manager."""

import asyncio
import os
import re
from urllib.request import Request, urlopen


METADATA_URL = "http://169.254.169.254/latest"


def get_instance_id() -> str:
    token_request = Request(
        f"{METADATA_URL}/api/token",
        headers={"X-aws-ec2-metadata-token-ttl-seconds": "60"},
        method="PUT",
    )
    with urlopen(token_request, timeout=2) as response:
        token = response.read().decode()
    if not token:
        raise RuntimeError("EC2 metadata service returned an empty IMDSv2 token")

    id_request = Request(
        f"{METADATA_URL}/meta-data/instance-id",
        headers={"X-aws-ec2-metadata-token": token},
    )
    with urlopen(id_request, timeout=2) as response:
        instance_id = response.read().decode().strip()
    if not re.fullmatch(r"i-[0-9a-f]+", instance_id):
        raise RuntimeError("EC2 metadata service returned an invalid instance ID")
    return instance_id


def _ec2_client():
    import boto3
    from botocore.config import Config

    return boto3.client(
        "ec2",
        region_name=os.environ["AWS_DEFAULT_REGION"],
        config=Config(
            connect_timeout=2,
            read_timeout=5,
            retries={"total_max_attempts": 2, "mode": "standard"},
        ),
    )


def stop_ec2_instance() -> None:
    _ec2_client().stop_instances(
        InstanceIds=[get_instance_id()], SkipOsShutdown=True
    )


async def request_instance_stop() -> None:
    await asyncio.to_thread(stop_ec2_instance)
