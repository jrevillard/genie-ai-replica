# GitHub OIDC stack

Grants GitHub Actions permission to deploy the application. Creates three things:

| Resource | Purpose |
|---|---|
| `aws_iam_openid_connect_provider` | Lets AWS trust GitHub-issued OIDC tokens. One per account. |
| `aws_iam_role` (`healthbot-dev-github-deploy`) | Assumed by the deploy workflow. |
| `aws_iam_role_policy` | Publish artifact to S3 + SSM RunCommand on the tagged instance. Nothing else. |

No long-lived AWS keys are stored in GitHub — that is the whole reason this exists.

## Why this is a separate stack

`aws_instance` is **not** in this state. Applying here therefore cannot replace,
stop or recreate the GPU box, which makes the "never request a new machine"
constraint (`docs/ci-cd-plan.md` §3.2) structural rather than a promise. It also
decouples "let GitHub in" from the pending workload-stack changes, so this can be
applied on its own.

## What the role deliberately cannot do

No `ec2:RunInstances`, `ec2:TerminateInstances`, `ec2:StopInstances`, and no
Terraform apply rights. A bug, a bad merge, or a compromised workflow cannot cost
a GPU instance. Terraform applies use a **separate** role, so provisioning rights
and deploy rights never sit in the same credential.

Two permission shapes that look wrong but are correct:

- `ssm:SendCommand` appears twice. It authorises against both the target instance
  and the document; a policy naming only one fails at runtime.
- The polling statement uses `Resource: "*"`. `ssm:GetCommandInvocation`,
  `ssm:DescribeInstanceInformation` and `ec2:DescribeInstances` do not support
  resource-level permissions.

The instance is scoped by its `Name` tag rather than by ARN, so this stack needs no
reference to the workload state and survives an instance rebuild.

## Apply (one-time)

Requires Terraform >= 1.10 — `backend.tf` uses native S3 state locking, which older
versions do not support. Note `terraform` is tfenv-managed in this repo and may have
no version selected: run `tfenv install 1.13.3 && tfenv use 1.13.3` first if
`terraform version` errors.

```bash
cd deploy/terraform/github-oidc
export AWS_PROFILE=healthbot-dev          # backend + provider both use this
cp terraform.tfvars.example terraform.tfvars

terraform init
terraform plan          # expect exactly 3 resources to add, 0 to change, 0 to destroy
terraform apply
```

Confirm you are in the right account before applying:

```bash
aws sts get-caller-identity --profile healthbot-dev   # expect Account 310997740503
```

`terraform plan` should never show changes to anything outside this stack. If it
proposes touching an EC2 instance, stop — you are in the wrong directory.

## Wiring the output into GitHub

```bash
terraform output -raw deploy_role_arn
```

Then, in the repository:

1. Create the GitHub Environment named **`dev`** (Settings → Environments). This is
   mandatory, not cosmetic: the trust policy keys on the
   `repo:<owner>/<repo>:environment:dev` subject claim, so a workflow job without
   `environment: dev` produces no matching claim and cannot authenticate.
2. Store the role ARN as a repository variable `AWS_DEPLOY_ROLE_ARN`.
3. The deploy job needs `permissions: { id-token: write, contents: read }`.

Deployment protection rules on private repositories require GitHub Team or
Enterprise. The environment itself works on any plan; only the *rules* are gated.

## Adding another environment later

Append to `github_environments` in `terraform.tfvars` and re-apply. Each entry
widens the trust policy, so add only environments that should be able to deploy.
A separate role per environment is better once permissions start to diverge.
