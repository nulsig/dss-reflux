// scripts/deploy.js
// Deploy DMAP, SignalVault via Create2Factory to Base network
const { ethers } = require("hardhat");
require("dotenv").config();

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying contracts with account:", deployer.address);

  // Deploy Create2Factory
  const Factory = await ethers.getContractFactory("Create2Factory");
  const factory = await Factory.deploy();
  await factory.deployed();
  console.log("Create2Factory deployed at", factory.address);

  // Prepare DMAP bytecode
  const DMAP = await ethers.getContractFactory("DMAP");
  const dmapBytecode = DMAP.bytecode;
  const dmapSalt = ethers.utils.id("DMAP");
  const dmapAddr = await factory.computeAddress(dmapBytecode, dmapSalt);

  // Deploy DMAP via CREATE2 if not exists
  if ((await ethers.provider.getCode(dmapAddr)).length <= 2) {
    const tx1 = await factory.deploy(dmapBytecode, dmapSalt);
    await tx1.wait();
    console.log("DMAP deployed at", dmapAddr);
  } else {
    console.log("DMAP already at", dmapAddr);
  }

  // Prepare SignalVault bytecode (with constructor args)
  const SignalVault = await ethers.getContractFactory("SignalVault");
  const vaultBytecode = SignalVault.getDeployTransaction(dmapAddr).data;
  const vaultSalt = ethers.utils.id("SignalVault");
  const vaultAddr = await factory.computeAddress(vaultBytecode, vaultSalt);

  // Deploy SignalVault via CREATE2
  if ((await ethers.provider.getCode(vaultAddr)).length <= 2) {
    const tx2 = await factory.deploy(vaultBytecode, vaultSalt);
    await tx2.wait();
    console.log("SignalVault deployed at", vaultAddr);
  } else {
    console.log("SignalVault already at", vaultAddr);
  }

  // Prepare Honeypot bytecode
  const Honeypot = await ethers.getContractFactory("Honeypot");
  const honeypotBytecode = Honeypot.getDeployTransaction(dmapAddr, vaultAddr, deployer.address).data;
  const honeypotSalt = ethers.utils.id("Honeypot");
  const honeypotAddr = await factory.computeAddress(honeypotBytecode, honeypotSalt);

  // Deploy Honeypot and authorize it in one transaction
  const vaultContract = await ethers.getContractAt("SignalVault", vaultAddr);
  if ((await ethers.provider.getCode(honeypotAddr)).length <= 2) {
    const tx3 = await factory.deployAndAuthorize(honeypotBytecode, honeypotSalt, vaultContract);
    await tx3.wait();
    console.log("Honeypot deployed at", honeypotAddr);
    console.log("Honeypot authorized with SignalVault");
  } else {
    console.log("Honeypot already at", honeypotAddr);
  }

console.log("Deployed addresses:", { dmap: dmapAddr, vault: vaultAddr, honeypot: honeypotAddr });

  // Write deployment report
  const fs = require('fs');
  const path = require('path');
  const report = {
    timestamp: Math.floor(Date.now() / 1000),
    dmap: dmapAddr,
    vault: vaultAddr,
    honeypot: honeypotAddr
  };
  const outputFile = path.resolve(__dirname, '../deployment.json');
  fs.writeFileSync(outputFile, JSON.stringify(report, null, 2));
  console.log('Deployment report written to', outputFile);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
