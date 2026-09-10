#!/bin/bash
set -e
ssh -i /home/fordendk/.ssh/cloud-deploy-np -o StrictHostKeyChecking=no govstack@10.0.0.101 "$@"
