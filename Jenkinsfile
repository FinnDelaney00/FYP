pipeline {
  agent any

  options {
    skipDefaultCheckout(true)
  }

  stages {
    stage('Checkout') {
      steps {
        checkout scm
      }
    }

    stage('Smoke test') {
      steps {
        bat '"C:\\terraform\\terraform.exe" version'
        bat 'dir'
        bat 'dir smartstream-terraform'
      }
    }
  }
}