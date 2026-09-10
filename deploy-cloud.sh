#!/bin/bash
set -e

# Copy vault password from Windows to WSL ext4 (chmod works there)
cp /mnt/d/ITU-Gitlab/deploy/ansible/.vault-pass-cloud_deploy ~/vault-pass-cloud_deploy
chmod 600 ~/vault-pass-cloud_deploy

cd /mnt/d/ITU-Gitlab/deploy/ansible
ansible-playbook -i inventory/cloud_deploy.ini deploy.yml --tags build,deploy --vault-id cloud_deploy@~/vault-pass-cloud_deploy
