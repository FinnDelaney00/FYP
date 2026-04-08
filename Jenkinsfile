pipeline {
  agent any

  options {
    skipDefaultCheckout(true)
  }

  parameters {
    string(name: 'COMPANY', defaultValue: '', description: 'Company name for tenant mode')
    choice(name: 'ENV', choices: ['dev', 'test', 'prod'], description: 'Deployment environment')
    choice(name: 'TARGET', choices: ['legacy', 'tenant'], description: 'Deployment target')
  }

  environment {
    TF_EXE                   = 'C:\\terraform\\terraform.exe'
    TF_DIR                   = 'smartstream-terraform'
    TF_IN_AUTOMATION         = 'true'
    LEGACY_WORKSPACE         = 'newaccount'
    AWS_EC2_METADATA_DISABLED = 'true'
  }

  stages {
    stage('Checkout') {
      steps {
        checkout scm
      }
    }

    stage('Validate parameters') {
      steps {
        script {
          def target = (params.TARGET ?: 'legacy').toString().trim()
          def deployEnv = (params.ENV ?: 'dev').toString().trim()
          def rawCompany = (params.COMPANY ?: '').toString().trim()

          def normalizedCompany = rawCompany
            .toLowerCase()
            .replaceAll(/[ _]+/, '-')
            .replaceAll(/[^a-z0-9-]/, '')
            .replaceAll(/-+/, '-')
            .replaceAll(/^-+|-+$/, '')

          if (target == 'tenant' && !normalizedCompany) {
            error('TARGET=tenant requires COMPANY to be set.')
          }

          env.NORMALIZED_COMPANY = normalizedCompany
          env.RESOLVED_WORKSPACE = (target == 'tenant') ? normalizedCompany : env.LEGACY_WORKSPACE

          if (target == 'tenant') {
            env.TF_MODE_ARGS = "-var \"enable_tenant_prefix=true\" -var \"company_name=${normalizedCompany}\" -var \"environment=${deployEnv}\" -var \"create_shared_iam=false\""
          } else {
            env.TF_MODE_ARGS = "-var \"enable_tenant_prefix=false\" -var \"environment=${deployEnv}\" -var \"create_shared_iam=true\""
          }

          echo "Resolved mode: TARGET=${target}, WORKSPACE=${env.RESOLVED_WORKSPACE}, COMPANY=${env.NORMALIZED_COMPANY}, ENV=${deployEnv}"
          echo "TF_MODE_ARGS=${env.TF_MODE_ARGS}"
        }
      }
    }

    stage('Check tools') {
      steps {
        bat "\"${env.TF_EXE}\" version"
        bat 'git --version'
        bat 'aws --version'
        bat "dir \"${env.TF_DIR}\""
      }
    }

    stage('Terraform init') {
      steps {
        withCredentials([
          usernamePassword(
            credentialsId: 'aws-smartstream',
            usernameVariable: 'AWS_ACCESS_KEY_ID',
            passwordVariable: 'AWS_SECRET_ACCESS_KEY'
          )
        ]) {
          dir("${env.TF_DIR}") {
            bat "\"${env.TF_EXE}\" init -input=false"
          }
        }
      }
    }

    stage('Terraform fmt + validate') {
      steps {
        dir("${env.TF_DIR}") {
          bat "\"${env.TF_EXE}\" fmt -check -recursive"
          bat "\"${env.TF_EXE}\" validate"
        }
      }
    }

    stage('Workspace select/new') {
      steps {
        withCredentials([
          usernamePassword(
            credentialsId: 'aws-smartstream',
            usernameVariable: 'AWS_ACCESS_KEY_ID',
            passwordVariable: 'AWS_SECRET_ACCESS_KEY'
          )
        ]) {
          dir("${env.TF_DIR}") {
            bat "\"${env.TF_EXE}\" workspace select \"${env.RESOLVED_WORKSPACE}\" || \"${env.TF_EXE}\" workspace new \"${env.RESOLVED_WORKSPACE}\""
          }
        }
      }
    }

    stage('Terraform plan') {
      steps {
        withCredentials([
          usernamePassword(
            credentialsId: 'aws-smartstream',
            usernameVariable: 'AWS_ACCESS_KEY_ID',
            passwordVariable: 'AWS_SECRET_ACCESS_KEY'
          )
        ]) {
          dir("${env.TF_DIR}") {
            bat 'aws sts get-caller-identity'
            bat "\"${env.TF_EXE}\" plan -input=false -out=tfplan ${env.TF_MODE_ARGS}"
          }
        }
      }
    }
  }

  post {
    always {
      echo "Build finished with status: ${currentBuild.currentResult}"
    }
  }
}