import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";
import * as awsx from "@pulumi/awsx";
import { Output } from "@pulumi/pulumi";

// VPC
const vpc = new aws.ec2.Vpc("pulumi_vpc", {
    cidrBlock: "10.1.0.0/16"
})

// Create two public subnets
const subnets = ['public-sub-1', 'public-sub-2']
const subnet_cidrs = ["10.1.1.0/24", "10.1.2.0/24"]
const subnet_ids = []
const az = ["us-west-2a", "us-west-2b"]

for (let i=0; i<subnets.length; i++){
    const subnet = new aws.ec2.Subnet(subnets[i], {
        vpcId: vpc.id,
        cidrBlock: subnet_cidrs[i],
        availabilityZone: az[i],
        mapPublicIpOnLaunch: true,
        tags: {
            Name: subnets[i]
        }
    })
    subnet_ids.push(subnet.id)
}

// IGW

const igw = new aws.ec2.InternetGateway("igw", {
    vpcId: vpc.id,
    tags: {
        Name: "main",
    },
});

// Route Table
const routeTable = new aws.ec2.RouteTable("public-sub-rtb", {
    vpcId: vpc.id,
    routes: [
        {
            cidrBlock: "0.0.0.0/0",
            gatewayId: igw.id,
        },
        {
            ipv6CidrBlock: "::/0",
            gatewayId: igw.id,
        },
    ],
    tags: {
        Name: "public-sub-rtb",
    },
});

// Route Table Association
const rtbAssociationNames = ["rtb-asoc-1", "rtb-asoc-2"]
for (let i = 0; i< subnet_ids.length; i++){
    const routeTableAssociation = new aws.ec2.RouteTableAssociation(rtbAssociationNames[i], {
        subnetId: subnet_ids[i],
        routeTableId: routeTable.id
    });
}


// EKS Role
const eksRole = new aws.iam.Role("eksRole", {assumeRolePolicy: `{
    "Version": "2012-10-17",
    "Statement": [
      {
        "Effect": "Allow",
        "Principal": {
          "Service": "eks.amazonaws.com"
        },
        "Action": "sts:AssumeRole"
      }
    ]
  }
  `});

  const example_AmazonEKSClusterPolicy = new aws.iam.RolePolicyAttachment("example-AmazonEKSClusterPolicy", {
    policyArn: "arn:aws:iam::aws:policy/AmazonEKSClusterPolicy",
    role: eksRole.name,
});
// Optionally, enable Security Groups for Pods
// Reference: https://docs.aws.amazon.com/eks/latest/userguide/security-groups-for-pods.html
const example_AmazonEKSVPCResourceController = new aws.iam.RolePolicyAttachment("example-AmazonEKSVPCResourceController", {
    policyArn: "arn:aws:iam::aws:policy/AmazonEKSVPCResourceController",
    role: eksRole.name,
});

// EKS Cluster
const eks = new aws.eks.Cluster("pulumi_cluster", {
    roleArn: eksRole.arn,
    vpcConfig: {
        subnetIds: subnet_ids
    }
}, {
    dependsOn: [
        example_AmazonEKSClusterPolicy,
        example_AmazonEKSVPCResourceController
    ],
});

export const endpoint = eks.endpoint;
export const kubeconfig_certificate_authority_data = eks.certificateAuthority.apply(certificateAuthority => certificateAuthority.data);

// EKS Node Group Role

const nodeGroupRole = new aws.iam.Role("nodeGroupRole", {assumeRolePolicy: JSON.stringify({
    Statement: [{
        Action: "sts:AssumeRole",
        Effect: "Allow",
        Principal: {
            Service: "ec2.amazonaws.com",
        },
    }],
    Version: "2012-10-17",
})});
const example_AmazonEKSWorkerNodePolicy = new aws.iam.RolePolicyAttachment("example-AmazonEKSWorkerNodePolicy", {
    policyArn: "arn:aws:iam::aws:policy/AmazonEKSWorkerNodePolicy",
    role: nodeGroupRole.name,
});
const example_AmazonEKSCNIPolicy = new aws.iam.RolePolicyAttachment("example-AmazonEKSCNIPolicy", {
    policyArn: "arn:aws:iam::aws:policy/AmazonEKS_CNI_Policy",
    role: nodeGroupRole.name,
});
const example_AmazonEC2ContainerRegistryReadOnly = new aws.iam.RolePolicyAttachment("example-AmazonEC2ContainerRegistryReadOnly", {
    policyArn: "arn:aws:iam::aws:policy/AmazonEC2ContainerRegistryReadOnly",
    role: nodeGroupRole.name,
});


// EKS Node Group
const nodeGroup = new aws.eks.NodeGroup("my_nodeGroup", {
    clusterName: eks.name,
    nodeRoleArn: nodeGroupRole.arn,
    subnetIds: subnet_ids,
    scalingConfig: {
        desiredSize: 1,
        maxSize: 2,
        minSize: 1,
    },
    updateConfig: {
        maxUnavailable: 1,
    },
    instanceTypes: ['t2.micro']
}, {
    dependsOn: [
        example_AmazonEKSWorkerNodePolicy,
        example_AmazonEKSCNIPolicy,
        example_AmazonEC2ContainerRegistryReadOnly
    ],
});