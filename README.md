# cdk8s-redis-sts  ![Release](https://github.com/opencdk8s/cdk8s-redis-sts/workflows/Release/badge.svg?branch=development)

Create a Replicated Redis Statefulset on Kubernetes, powered by the [cdk8s project](https://cdk8s.io) 🚀

## Disclaimer 

This construct is under heavy development, and breaking changes will be introduced very often. Please don't forget to version lock your code if you are using this construct.

## Overview

**cdk8s-redis-sts** is a [cdk8s](https://cdk8s.io) library.

```typescript
import { Construct } from 'constructs';
import { App, Chart, ChartProps } from 'cdk8s';
import { MyRedis } from '@opencdk8s/cdk8s-redis-sts';

export class MyChart extends Chart {
  constructor(scope: Construct, id: string, props: ChartProps = { }) {
    super(scope, id, props);
    new MyRedis(this, 'dev', {
        image: 'redis',
        namespace: 'databases',
        volumeSize: '10Gi',
        replicas: 2,
        createStorageClass: true,
        volumeProvisioner: 'kubernetes.io/aws-ebs',
        storageClassName: "io1-slow",
        storageClassParams: {
          type: 'io1',
          fsType: 'ext4',
          iopsPerGB: "10",
        },
    });
    }
}

const app = new App();
new MyChart(app, 'dev');
app.synth();
```

Create a configmap for your redis statefulset with the same name as your statefulset :

```
apiVersion: v1
kind: ConfigMap
metadata:
  name: dev
data:
  master.conf: |
    bind 0.0.0.0
    port 6379
    tcp-backlog 511
    timeout 0
    tcp-keepalive 300
    daemonize no
    supervised no
  slave.conf: |
    slaveof dev 6379 # dev should be the name of your service
```


Then the Kubernetes manifests created by `cdk8s synth` command will have Kubernetes resources such as `Statefulset`, and `Service` as follows.

<details>
<summary>manifest.k8s.yaml</summary>

```yaml
apiVersion: v1
kind: Service
metadata:
  labels:
    app: dev
  name: dev
  namespace: databases
spec:
  ports:
    - port: 6379
      targetPort: 6379
  selector:
    app: dev
  type: ClusterIP
---
apiVersion: apps/v1
kind: StatefulSet
metadata:
  labels:
    app: dev
  name: dev
  namespace: databases
spec:
  replicas: 2
  selector:
    matchLabels:
      app: dev
  serviceName: dev
  template:
    metadata:
      labels:
        app: dev
    spec:
      containers:
        - command:
            - bash
            - -c
            - |-
              [[ `hostname` =~ -([0-9]+)$ ]] || exit 1
              ordinal=${BASH_REMATCH[1]}
              if [[ $ordinal -eq 0 ]]; then
              echo "starting master"
              redis-server /mnt/redis/master.conf
              else
              echo "starting slave"
              redis-server /mnt/redis/slave.conf
              fi
          env: []
          image: redis
          name: redis
          ports:
            - containerPort: 6379
          resources:
            limits:
              cpu: 400m
              memory: 512Mi
            requests:
              cpu: 200m
              memory: 256Mi
          volumeMounts:
            - mountPath: /data
              name: dev
            - mountPath: /mnt/redis/
              name: dev-redis-conf
      terminationGracePeriodSeconds: 10
      volumes:
        - configMap:
            name: dev-redis-conf
          name: dev-redis-conf
  volumeClaimTemplates:
    - metadata:
        name: dev
        namespace: databases
      spec:
        accessModes:
          - ReadWriteOnce
        resources:
          requests:
            storage: 10Gi
```

</details>

## Installation

### TypeScript

Use `yarn` or `npm` to install.

```sh
$ npm install cdk8s-redis-sts
```

```sh
$ yarn add cdk8s-redis-sts
```

### Python

```sh
$ pip install cdk8s-redis-sts
```

## Contribution

1. Fork ([https://github.com/Hunter-Thompson/cdk8s-mongo-sts/fork](https://github.com/Hunter-Thompson/cdk8s-redis-sts/fork))
2. Bootstrap the repo:
  
    ```bash
    npx projen   # generates package.json 
    yarn install # installs dependencies
    ```
3. Development scripts:
   |Command|Description
   |-|-
   |`yarn compile`|Compiles typescript => javascript
   |`yarn watch`|Watch & compile
   |`yarn test`|Run unit test & linter through jest
   |`yarn test -u`|Update jest snapshots
   |`yarn run package`|Creates a `dist` with packages for all languages.
   |`yarn build`|Compile + test + package
   |`yarn bump`|Bump version (with changelog) based on [conventional commits]
   |`yarn release`|Bump + push to `master`
4. Create a feature branch
5. Commit your changes
6. Rebase your local changes against the master branch
7. Create a new Pull Request (use [conventional commits](https://www.conventionalcommits.org/en/v1.0.0/) for the title please)

## Licence

[Apache License, Version 2.0](./LICENSE)

## Author

[Hunter-Thompson](https://github.com/Hunter-Thompson)
