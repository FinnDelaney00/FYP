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
        bat '"C:\\terraform\\terraform.exe" init -input=false'
        bat '"C:\\terraform\\terraform.exe" fmt -check -recursive'
        bat '"C:\\terraform\\terraform.exe" validate'
        bat '"C:\\terraform\\terraform.exe" workspace list'
        bat '"C:\\terraform\\terraform.exe" plan -input=false -out=tfplan'
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
}pipeline {
  agent any

  options {
    skipDefaultCheckout(true)
  }

  parameters {
    string(name: 'COMPANY', defaultValue: '', description: 'Company name for tenant mode')
    choice(name: 'ENV', choices: ['dev', 'test', 'prod'], description: 'Deployment environment')
    choice(name: 'ACTION', choices: ['plan', 'apply', 'destroy'], description: 'Terraform action')
    choice(name: 'TARGET', choices: ['legacy', 'tenant'], description: 'Deployment target')
  }

  environment {
    TF_EXE             = 'C:\\terraform\\terraform.exe'
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
          def target = (params.TARGET ?: 'legacy').toString().trim()
          def actionName = (params.ACTION ?: 'plan').toString().trim()
          def deployEnv = (params.ENV ?: 'dev').toString().trim()
          def rawCompany = (params.COMPANY ?: '').toString().trim()

          def normalizedCompany = rawCompany
            .toLowerCase()
            .replaceAll(/[ _]+/, '-')
            .replaceAll(/[^a-z0-9-]/, '')
            .replaceAll(/-+/, '-')
            .replaceAll(/^-+|-+$/, '')

          if (!(target in ['legacy', 'tenant'])) {
            error("Invalid TARGET value: ${target}")
          }

          if (!(actionName in ['plan', 'apply', 'destroy'])) {
            error("Invalid ACTION value: ${actionName}")
          }

          if (target == 'tenant' && !normalizedCompany) {
            error('TARGET=tenant requires COMPANY to be set.')
          }

          if (target == 'tenant' && normalizedCompany.length() > 30) {
            error('Normalized COMPANY must be 30 characters or fewer.')
          }

          def resolvedWorkspace = (target == 'tenant') ? normalizedCompany : env.LEGACY_WORKSPACE
          def tfModeArgs = (target == 'tenant')
            ? """-var "enable_tenant_prefix=true" -var "company_name=${normalizedCompany}" -var "environment=${deployEnv}" -var "create_shared_iam=false" """
            : """-var "enable_tenant_prefix=false" -var "environment=${deployEnv}" -var "create_shared_iam=true" """

          env.NORMALIZED_COMPANY = normalizedCompany
          env.RESOLVED_WORKSPACE = resolvedWorkspace
          env.TF_MODE_ARGS = tfModeArgs.trim()

          echo "Resolved mode: TARGET=${target}, ACTION=${actionName}, WORKSPACE=${env.RESOLVED_WORKSPACE}, COMPANY=${env.NORMALIZED_COMPANY}, ENV=${deployEnv}"
          echo "TF_MODE_ARGS=${env.TF_MODE_ARGS}"
        }
      }
    }

    stage('Check tools') {
      steps {
        bat "if not exist \"${env.TF_EXE}\" (echo Terraform executable not found at ${env.TF_EXE} & exit /b 1)"
        bat "\"${env.TF_EXE}\" version"
        bat 'git --version'
        bat "if not exist \"${env.TF_DIR}\" (echo Missing Terraform directory: ${env.TF_DIR} & exit /b 1)"
        bat "dir \"${env.TF_DIR}\""
      }
    }

    stage('Terraform init') {
      steps {
        dir("${env.TF_DIR}") {
          bat "\"${env.TF_EXE}\" init -input=false"
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
        dir("${env.TF_DIR}") {
          bat "\"${env.TF_EXE}\" workspace select \"${env.RESOLVED_WORKSPACE}\" || \"${env.TF_EXE}\" workspace new \"${env.RESOLVED_WORKSPACE}\""
        }
      }
    }

    stage('Terraform plan') {
      steps {
        script {
          def destroyFlag = (params.ACTION == 'destroy') ? '-destroy' : ''

          dir("${env.TF_DIR}") {
            bat "\"${env.TF_EXE}\" plan -input=false ${destroyFlag} -out=tfplan ${env.TF_MODE_ARGS}"
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
          bat "\"${env.TF_EXE}\" apply -input=false tfplan"
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