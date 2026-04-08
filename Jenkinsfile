pipeline {
  agent any

  parameters {
    string(name: 'COMPANY', defaultValue: '', description: 'Company name (required for tenant target)')
    choice(name: 'ENV', choices: ['dev', 'test', 'prod'], description: 'Deployment environment')
    choice(name: 'ACTION', choices: ['plan', 'apply', 'destroy'], description: 'Terraform action')
    choice(name: 'TARGET', choices: ['tenant', 'legacy'], description: 'Deployment target')
  }

  environment {
    TF_DIR             = 'smartstream-terraform'
    TF_IN_AUTOMATION   = 'true'
    LEGACY_WORKSPACE   = 'newaccount'
    NORMALIZED_COMPANY = ''
    RESOLVED_WORKSPACE = ''
    TF_MODE_ARGS       = ''
  }

  stages {
    stage('Checkout') {
      steps {
        checkout scm
      }
    }

    stage('Validate parameters + resolved mode') {
      steps {
        script {
          def normalizedCompany = (params.COMPANY ?: '')
            .trim()
            .toLowerCase()
            .replaceAll(/[ _]+/, '-')
            .replaceAll(/[^a-z0-9-]/, '')
            .replaceAll(/-+/, '-')
            .replaceAll(/^-+|-+$/, '')

          if (params.TARGET == 'tenant' && normalizedCompany.length() == 0) {
            error('TARGET=tenant requires a non-empty COMPANY after normalization.')
          }

          if (params.TARGET == 'tenant' && normalizedCompany.length() > 30) {
            error('Normalized COMPANY must be 30 characters or fewer.')
          }

          env.NORMALIZED_COMPANY = normalizedCompany
          env.RESOLVED_WORKSPACE = (params.TARGET == 'tenant') ? normalizedCompany : env.LEGACY_WORKSPACE

          if (params.TARGET == 'tenant') {
            env.TF_MODE_ARGS = '-var "enable_tenant_prefix=true" ' +
                               '-var "company_name=' + env.NORMALIZED_COMPANY + '" ' +
                               '-var "environment=' + params.ENV + '" ' +
                               '-var "create_shared_iam=false"'
          } else {
            env.TF_MODE_ARGS = '-var "enable_tenant_prefix=false" ' +
                               '-var "environment=' + params.ENV + '" ' +
                               '-var "create_shared_iam=true"'
          }

          echo "Resolved mode: TARGET=${params.TARGET}, ACTION=${params.ACTION}, WORKSPACE=${env.RESOLVED_WORKSPACE}, COMPANY=${env.NORMALIZED_COMPANY}, ENV=${params.ENV}"
          echo "TF_MODE_ARGS=${env.TF_MODE_ARGS}"
        }
      }
    }

    stage('Check tools') {
      steps {
        bat 'echo PATH=%PATH%'
        bat 'where terraform'
        bat 'terraform version'
        bat 'where git'
        bat 'git --version'
      }
    }

    stage('Terraform init') {
      steps {
        dir("${env.TF_DIR}") {
          bat 'terraform init -input=false'
        }
      }
    }

    stage('Terraform fmt + validate') {
      steps {
        dir("${env.TF_DIR}") {
          bat 'terraform fmt -check -recursive'
          bat 'terraform validate'
        }
      }
    }

    stage('Workspace select/new') {
      steps {
        dir("${env.TF_DIR}") {
          bat """
@if not exist .terraform (
  echo Terraform has not been initialized.
  exit /b 1
)

terraform workspace select "${env.RESOLVED_WORKSPACE}"
if errorlevel 1 (
  terraform workspace new "${env.RESOLVED_WORKSPACE}"
)
"""
        }
      }
    }

    stage('Terraform plan') {
      steps {
        script {
          def destroyFlag = (params.ACTION == 'destroy') ? '-destroy' : ''

          dir("${env.TF_DIR}") {
            bat """
terraform plan -input=false ${destroyFlag} -out=tfplan ${env.TF_MODE_ARGS}
"""
          }
        }
      }
    }

    stage('Manual approval') {
      when {
        anyOf {
          expression { params.ACTION == 'apply' }
          expression { params.ACTION == 'destroy' }
        }
      }
      steps {
        timeout(time: 20, unit: 'MINUTES') {
          input message: "Approve ${params.ACTION.toUpperCase()} for TARGET=${params.TARGET} in workspace ${env.RESOLVED_WORKSPACE}?"
        }
      }
    }

    stage('Apply/Destroy') {
      when {
        anyOf {
          expression { params.ACTION == 'apply' }
          expression { params.ACTION == 'destroy' }
        }
      }
      steps {
        dir("${env.TF_DIR}") {
          bat 'terraform apply -input=false tfplan'
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