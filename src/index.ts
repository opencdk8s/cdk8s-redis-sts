import { Construct } from 'constructs';
import * as k8s from './imports/k8s';


export interface StsOpts {
  /**
   * @default 1
   */
  readonly replicas?: number;

  /**
   * Container image.
   */
  readonly image: string;

  /**
   * namespace
   * @default - default
   */
  readonly namespace: string;

  /**
   * Option to create storage class, if enabled, a storage class will be created for the statefulset
   * @default true
   */
  readonly createStorageClass?: boolean;

  /**
   * The storage class to use for our PVC
   * @default 'gp2-expandable'
   */
  readonly storageClassName?: string;

  /**
   * Each StorageClass has a provisioner that determines what volume plugin is used for provisioning PVs. This field must be specified.
   * See [this](https://kubernetes.io/docs/concepts/storage/storage-classes/#provisioner) for Ref
   * @default 'kubernetes.io/aws-ebs'
   */
  readonly volumeProvisioner?: string;

  /**
   * Storage class params
   * @default - { type = gp2, fsType: ext4 }
   */
  readonly storageClassParams?: { [name: string]: string };

  /**
   * nodeSelector params
   * @default - undefined
   */
  readonly nodeSelectorParams?: { [name: string]: string };

  /**
   * Additional labels to apply to resources.
   * @default - none
   */
  readonly labels?: { [name: string]: string };

  /**
   * Resources requests for the DB.
   * @default - Requests = { CPU = 200m, Mem = 256Mi }, Limits = { CPU = 400m, Mem = 512Mi }
   */
  readonly resources?: ResourceRequirements;


  /**
   * The Volume size of our DB in string, e.g 10Gi, 20Gi
   */
  readonly volumeSize?: string;

  /**
   * Environment variables to pass to the pod
   */
  readonly env?: { [name: string]: string };

}

export interface ResourceRequirements {
  /**
   * Maximum resources for the web app.
   * @default - CPU = 400m, Mem = 512Mi
   */
  readonly limits?: ResourceQuantity;

  /**
   * Required resources for the web app.
   * @default - CPU = 200m, Mem = 256Mi
   */
  readonly requests?: ResourceQuantity;
}

export interface ResourceQuantity {
  /**
   * @default - no limit
   */
  readonly cpu?: string;

  /**
   * @default - no limit
   */
  readonly memory?: string;
}


export class MyRedis extends Construct {
  public readonly name: string;
  public readonly namespace: string;


  constructor(scope: Construct, name: string, opts: StsOpts) {
    super(scope, name);

    const namespace = opts.namespace ?? 'default';
    this.namespace = namespace;
    var storageClassName = opts.storageClassName ?? 'gp2';
    const volumeProvisioner = opts.volumeProvisioner ?? 'kubernetes.io/aws-ebs';
    const storageClassParams = opts.storageClassParams ?? { type: 'gp2', fsType: 'ext4' };
    const volumeRequest = {
      storage: k8s.Quantity.fromString(String(opts.volumeSize)),
    };
    const replicas = opts.replicas ?? 1;
    const resources = {
      limits: convertQuantity(opts.resources?.limits, {
        cpu: '400m',
        memory: '512Mi',
      }),
      requests: convertQuantity(opts.resources?.requests, {
        cpu: '200m',
        memory: '256Mi',
      }),
    };
    const nodeSelectorParams = opts.nodeSelectorParams ?? undefined;


    const label = {
      ...opts.labels,
      app: name,
    };

    if (opts.createStorageClass === true) {
      const storageClassOpts: k8s.KubeStorageClassProps = {
        metadata: {
          name: storageClassName,
        },
        provisioner: volumeProvisioner,
        allowVolumeExpansion: true,
        reclaimPolicy: 'Retain',
        parameters: {
          ...storageClassParams,
        },
      };
      const storageclass = new k8s.KubeStorageClass(this, 'storageclass', storageClassOpts);
      this.name = storageclass.name;
      var storageClassName = storageclass.name;
    }

    const serviceOpts: k8s.KubeServiceProps = {
      metadata: {
        labels: label,
        name: name,
        namespace: namespace,
      },
      spec: {
        type: 'ClusterIP',
        selector: label,
        ports: [{ port: 6379, targetPort: k8s.IntOrString.fromNumber(6379) }],
      },
    };

    const svc = new k8s.KubeService(this, 'service', serviceOpts);
    this.name = svc.name;

    const pvcProps: k8s.KubePersistentVolumeClaimProps = {
      metadata: {
        name: name,
        namespace: namespace,
      },
      spec: {
        accessModes: ['ReadWriteOnce'],
        storageClassName: storageClassName,
        resources: {
          requests: volumeRequest,
        },
      },
    };

    // const initRedis: k8s.Container = {
    //   name: 'init-redis',
    //   image: opts.image,
    //   command: [
    //     'bash',
    //     '-c',
    //     'set -ex\n# Generate mysql server-id from pod ordinal index.\nmkdir -p /etc/redis\n[[ `hostname` =~ -([0-9]+)$ ]] || exit 1\nordinal=${BASH_REMATCH[1]}\n# Copy appropriate conf.d files from config-map to emptyDir.\nif [[ $ordinal -eq 0 ]]; then\ncp /mnt/redis/master.conf /etc/redis/redis.conf\nelse\ncp /mnt/redis/slave.conf /etc/redis/redis.conf\nfi',
    //   ],
    //   volumeMounts: [{
    //     name: name,
    //     mountPath: '/data',
    //   },
    //   {
    //     name: `${name}-redis-conf`,
    //     mountPath: '/mnt/config-map',
    //   }],
    // };

    const redis: k8s.Container = {
      name: 'redis',
      image: opts.image,
      ports: [{
        containerPort: 6379,
      }],
      command: [
        'bash',
        '-c',
        '[[ `hostname` =~ -([0-9]+)$ ]] || exit 1\nordinal=${BASH_REMATCH[1]}\nif [[ $ordinal -eq 0 ]]; then\nredis-server /mnt/redis/master.conf\nelse\nredis-server /mnt/redis/slave.conf\nfi',
      ],
      resources: resources,
      env: renderEnv(opts.env),
      volumeMounts: [{
        name: name,
        mountPath: '/data',
      },
      {
        name: `${name}-redis-conf`,
        mountPath: '/mnt/redis/',
      }],
    };

    const stsOpts: k8s.KubeStatefulSetProps = {
      metadata: {
        labels: label,
        name: name,
        namespace: namespace,
      },
      spec: {
        serviceName: svc.name,
        replicas: replicas,
        selector: { matchLabels: label },
        template: {
          metadata: { labels: label },
          spec: {
            containers: [
              redis,
            ],
            terminationGracePeriodSeconds: 10,
            nodeSelector: nodeSelectorParams,
            volumes: [{
              name: `${name}-redis-conf`,
              configMap: {
                name: `${name}-redis-conf`,
              },
            }],
          },
        },
        volumeClaimTemplates: [pvcProps],
      },
    };
    const sts = new k8s.KubeStatefulSet(this, 'statefulset', stsOpts);
    this.name = sts.name;
  }
}

function renderEnv(env: { [key: string]: string } = { }): k8s.EnvVar[] {
  const result = new Array<k8s.EnvVar>();
  for (const [key, value] of Object.entries(env)) {
    result.push({
      name: key,
      value: value,
    });
  }
  return result;
}


/**
 * Converts a `ResourceQuantity` type to a k8s.Quantity map.
 *
 * If `user` is defined, the values provided there (or lack thereof) will be
 * passed on. This means that if the user, for example, did not specify a value
 * for `cpu`, this value will be omitted from the resource requirements. This is
 * intentional, in case the user intentionally wants to omit a constraint.
 *
 * If `user` is not defined, `defaults` are used.
 */

function convertQuantity(
  user: ResourceQuantity | undefined,
  defaults: { cpu: string; memory: string },
): { [key: string]: k8s.Quantity } {
  // defaults
  if (!user) {
    return {
      cpu: k8s.Quantity.fromString(defaults.cpu),
      memory: k8s.Quantity.fromString(defaults.memory),
    };
  }

  const result: { [key: string]: k8s.Quantity } = {};

  if (user.cpu) {
    result.cpu = k8s.Quantity.fromString(user.cpu);
  }

  if (user.memory) {
    result.memory = k8s.Quantity.fromString(user.memory);
  }

  return result;
}