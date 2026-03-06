pipeline {
  agent any

  parameters {
    string(name: 'COMPANY', defaultValue: '', description: 'Company name (required for tenant target)')
    choice(name: 'ENV', choices: ['dev', 'test', 'prod'], description: 'Deployment environment')
    choice(name: 'ACTION', choices: ['plan', 'apply', 'destroy'], description: 'Terraform action')
    choice(name: 'TARGET', choices: ['tenant', 'legacy'], description: 'Deployment target')
  }

  environment {
    TF_DIR            = 'smartstream-terraform'
    TF_IN_AUTOMATION  = 'true'
    LEGACY_WORKSPACE  = 'newaccount'
    NORMALIZED_COMPANY = ''
    RESOLVED_WORKSPACE = ''
    TF_MODE_ARGS      = ''
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
          env.RESOLVED_WORKSPACE = params.TARGET == 'tenant' ? normalizedCompany : env.LEGACY_WORKSPACE
          env.TF_MODE_ARGS = params.TARGET == 'tenant'
            ? "-var 'enable_tenant_prefix=true' -var 'company_name=${env.NORMALIZED_COMPANY}' -var 'environment=${params.ENV}' -var 'create_shared_iam=false'"
            : "-var 'enable_tenant_prefix=false' -var 'environment=${params.ENV}' -var 'create_shared_iam=true'"

          echo "Resolved mode: TARGET=${params.TARGET}, ACTION=${params.ACTION}, WORKSPACE=${env.RESOLVED_WORKSPACE}, COMPANY=${env.NORMALIZED_COMPANY}, ENV=${params.ENV}"
        }
      }
    }

    stage('Terraform init') {
      steps {
        sh """
          cd '${env.TF_DIR}'
          terraform init -input=false
        """
      }
    }

    stage('Terraform fmt + validate') {
      steps {
        sh """
          cd '${env.TF_DIR}'
          terraform fmt -check -recursive
          terraform validate
        """
      }
    }

    stage('Workspace select/new') {
      steps {
        sh """
          cd '${env.TF_DIR}'
          terraform workspace select '${env.RESOLVED_WORKSPACE}' || terraform workspace new '${env.RESOLVED_WORKSPACE}'
        """
      }
    }

    stage('Terraform plan') {
      steps {
        script {
          def destroyFlag = params.ACTION == 'destroy' ? '-destroy' : ''
          sh """
            cd '${env.TF_DIR}'
            terraform plan -input=false ${destroyFlag} -out tfplan ${env.TF_MODE_ARGS}
          """
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
        sh """
          cd '${env.TF_DIR}'
          terraform apply -input=false tfplan
        """
      }
    }
  }
}
