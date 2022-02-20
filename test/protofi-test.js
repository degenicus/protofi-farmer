const hre = require('hardhat');
const chai = require('chai');
const { solidity } = require('ethereum-waffle');
chai.use(solidity);
const { expect } = chai;

const moveTimeForward = async seconds => {
  await network.provider.send('evm_increaseTime', [seconds]);
  await network.provider.send('evm_mine');
};

const toWantUnit = (num, isUSDC = false) => {
  if (isUSDC) {
    return ethers.BigNumber.from(num * 10 ** 8);
  }
  return ethers.utils.parseEther(num);
};

describe('Vaults', function () {
  let Vault;
  let Strategy;
  let Treasury;
  let Want;
  let vault;
  let strategy;
  const paymentSplitterAddress = '0x63cbd4134c2253041F370472c130e92daE4Ff174';
  let treasury;
  let want;
  const ftmUsdcLPAddress = '0x1a8a4Dc716e9379e84E907B0c740d2c622F7cfb7';
  const wantAddress = ftmUsdcLPAddress;
  let self;
  let wantWhale;
  let selfAddress;
  let strategist;
  let owner;

  beforeEach(async function () {
    //reset network
    await network.provider.request({
      method: 'hardhat_reset',
      params: [
        {
          forking: {
            jsonRpcUrl: 'https://rpc.ftm.tools/',
            blockNumber: 31220919,
          },
        },
      ],
    });
    console.log('providers');
    //get signers
    [owner, addr1, addr2, addr3, addr4, ...addrs] = await ethers.getSigners();
    const wantHolder = '0x99d9956a937d29c85068cbd4fe4b1e68e37b0706'; // ftm-usdc
    const wantWhaleAddress = '0x70083a816329942e7e962829aff470b3015ff545'; // ftm-usdc
    const strategistAddress = '0x3b410908e71Ee04e7dE2a87f8F9003AFe6c1c7cE';
    await hre.network.provider.request({
      method: 'hardhat_impersonateAccount',
      params: [wantHolder],
    });
    await hre.network.provider.request({
      method: 'hardhat_impersonateAccount',
      params: [wantWhaleAddress],
    });
    await hre.network.provider.request({
      method: 'hardhat_impersonateAccount',
      params: [strategistAddress],
    });
    self = await ethers.provider.getSigner(wantHolder);
    wantWhale = await ethers.provider.getSigner(wantWhaleAddress);
    strategist = await ethers.provider.getSigner(strategistAddress);
    selfAddress = await self.getAddress();
    ownerAddress = await owner.getAddress();
    console.log('addresses');

    //get artifacts
    Strategy = await ethers.getContractFactory('ReaperAutoCompoundProtofiFarmer');
    Vault = await ethers.getContractFactory('ReaperVaultv1_3');
    Treasury = await ethers.getContractFactory('ReaperTreasury');
    Want = await ethers.getContractFactory('@openzeppelin/contracts/token/ERC20/ERC20.sol:ERC20');
    console.log('artifacts');

    //deploy contracts
    treasury = await Treasury.deploy();
    console.log('treasury');
    want = await Want.attach(wantAddress);
    console.log('want attached');
    const depositFee = 10;
    vault = await Vault.deploy(
      wantAddress,
      'Protofi FTM-USDC Vault',
      'rfPF-FTM-USDC',
      depositFee,
      ethers.utils.parseEther('999999'),
    );
    console.log('vault');

    console.log(`vault.address: ${vault.address}`);
    console.log(`treasury.address: ${treasury.address}`);

    const poolId = 2; // FTM-USDC

    console.log('strategy');
    strategy = await hre.upgrades.deployProxy(
      Strategy,
      [vault.address, [treasury.address, paymentSplitterAddress], [strategistAddress], wantAddress, poolId],
      { kind: 'uups' },
    );
    await strategy.deployed();

    await vault.initialize(strategy.address);

    console.log(`Strategy deployed to ${strategy.address}`);
    console.log(`Vault deployed to ${vault.address}`);
    console.log(`Treasury deployed to ${treasury.address}`);

    //approving LP token and vault share spend
    console.log('approving...');
    await want.approve(vault.address, ethers.utils.parseEther('1000000000'));
    await want.connect(self).approve(vault.address, ethers.utils.parseEther('1000000000'));
    await want.connect(wantWhale).approve(vault.address, ethers.utils.parseEther('1000000000'));
    console.log('approvals4');
    await vault.connect(wantWhale).approve(vault.address, ethers.utils.parseEther('1000000000'));
  });

  describe('Deploying the vault and strategy', function () {
    xit('should initiate vault with a 0 balance', async function () {
      console.log(1);
      const totalBalance = await vault.balance();
      console.log(2);
      const availableBalance = await vault.available();
      console.log(3);
      const pricePerFullShare = await vault.getPricePerFullShare();
      console.log(4);
      expect(totalBalance).to.equal(0);
      console.log(5);
      expect(availableBalance).to.equal(0);
      console.log(6);
      expect(pricePerFullShare).to.equal(ethers.utils.parseEther('1'));
    });
  });
  describe('Vault Tests', function () {
    xit('should allow deposits and account for them correctly', async function () {
      const userBalance = await want.balanceOf(selfAddress);
      console.log(`userBalance: ${userBalance}`);
      const vaultBalance = await vault.balance();
      console.log(`vaultBalance: ${vaultBalance}`);
      const depositAmount = toWantUnit('0.0007');
      console.log(`depositAmount: ${depositAmount}`);
      await vault.connect(self).deposit(depositAmount);
      const newVaultBalance = await vault.balance();
      console.log(`newVaultBalance: ${newVaultBalance}`);
      const newUserBalance = await want.balanceOf(selfAddress);
      console.log(`newUserBalance: ${newUserBalance}`);
      const depositFee = 10;
      const BASIS_POINTS = 10000;
      const depositLoss = (depositAmount * depositFee) / BASIS_POINTS;
      console.log(depositLoss);
      const allowedInaccuracy = depositAmount.div(200);
      expect(depositAmount).to.be.closeTo(newVaultBalance.sub(depositLoss), allowedInaccuracy);
    });

    xit('should mint user their pool share', async function () {
      console.log('---------------------------------------------');
      const userBalance = await want.balanceOf(selfAddress);
      console.log(userBalance.toString());
      const selfDepositAmount = toWantUnit('0.0007');
      console.log(selfDepositAmount);
      await vault.connect(self).deposit(selfDepositAmount);
      console.log((await vault.balance()).toString());

      const whaleBalance = await want.connect(wantWhale).balanceOf(selfAddress);
      console.log(`whaleBalance: ${whaleBalance.toString()}`);
      const whaleDepositAmount = toWantUnit('0.001');
      console.log(`whaleDepositAmount: ${whaleDepositAmount}`);
      await vault.connect(wantWhale).deposit(whaleDepositAmount);
      const selfWantBalance = await vault.balanceOf(selfAddress);
      console.log(selfWantBalance.toString());
      const ownerDepositAmount = toWantUnit('0.0001');
      await want.connect(self).transfer(ownerAddress, ownerDepositAmount);
      const ownerBalance = await want.balanceOf(ownerAddress);

      console.log(ownerBalance.toString());
      await vault.deposit(ownerDepositAmount);
      console.log((await vault.balance()).toString());
      const ownerVaultWantBalance = await vault.balanceOf(ownerAddress);
      console.log(`ownerVaultWantBalance.toString(): ${ownerVaultWantBalance.toString()}`);
      await vault.withdrawAll();
      const ownerWantBalance = await want.balanceOf(ownerAddress);
      console.log(`ownerWantBalance: ${ownerWantBalance}`);
      const ownerVaultWantBalanceAfterWithdraw = await vault.balanceOf(ownerAddress);
      console.log(`ownerVaultWantBalanceAfterWithdraw: ${ownerVaultWantBalanceAfterWithdraw}`);
      const allowedImprecision = toWantUnit('0.0001');
      const ownerDepositFee = (ownerDepositAmount * 10) / 10000;
      expect(ownerWantBalance).to.be.closeTo(ownerDepositAmount.sub(ownerDepositFee), allowedImprecision);
      const selfDepositFee = (selfDepositAmount * 10) / 10000;
      expect(selfWantBalance).to.equal(selfDepositAmount - selfDepositFee);
    });

    xit('should allow withdrawals', async function () {
      const userBalance = await want.balanceOf(selfAddress);
      console.log(`userBalance: ${userBalance}`);
      const depositAmount = toWantUnit('0.0007');
      await vault.connect(self).deposit(depositAmount);
      console.log(`await want.balanceOf(selfAddress): ${await want.balanceOf(selfAddress)}`);

      await vault.connect(self).withdrawAll();
      const newUserVaultBalance = await vault.balanceOf(selfAddress);
      console.log(`newUserVaultBalance: ${newUserVaultBalance}`);
      const userBalanceAfterWithdraw = await want.balanceOf(selfAddress);
      const securityFee = 10;
      const depositFee = 10;
      const percentDivisor = 10000;
      const withdrawFee = (depositAmount * securityFee) / percentDivisor;
      const depositFeePayed = (depositAmount * depositFee) / percentDivisor;
      const expectedBalance = userBalance.sub(withdrawFee).sub(depositFeePayed);
      const smallDifference = expectedBalance * 0.002;
      console.log(`expectedBalance.sub(userBalanceAfterWithdraw): ${expectedBalance.sub(userBalanceAfterWithdraw)}`);
      console.log(`smallDifference: ${smallDifference}`);
      const isSmallBalanceDifference = expectedBalance.sub(userBalanceAfterWithdraw) < smallDifference;
      expect(isSmallBalanceDifference).to.equal(true);
    });

    xit('should trigger leveraging on withdraw when LTV is too low', async function () {
      const startingLTV = toWantUnit('0.6');
      await strategy.setTargetLtv(startingLTV);
      const depositAmount = toWantUnit('100', true);

      await vault.connect(self).deposit(depositAmount);
      const ltvBefore = await strategy.calculateLTV();
      console.log(`ltvBefore: ${ltvBefore}`);
      const allowedLTVDrift = toWantUnit('0.01');
      expect(ltvBefore).to.be.closeTo(startingLTV, allowedLTVDrift);
      const newLTV = toWantUnit('0.7');
      await strategy.setTargetLtv(newLTV);
      const smallWithdrawAmount = toWantUnit('1', true);
      const userBalance = await want.balanceOf(selfAddress);
      await vault.connect(self).withdraw(smallWithdrawAmount);
      const userBalanceAfterWithdraw = await want.balanceOf(selfAddress);
      const ltvAfter = await strategy.calculateLTV();
      console.log(`ltvAfter: ${ltvAfter}`);
      expect(ltvAfter).to.be.closeTo(newLTV, allowedLTVDrift);

      const securityFee = 10;
      const percentDivisor = 10000;
      const withdrawFee = smallWithdrawAmount.mul(securityFee).div(percentDivisor);
      const expectedBalance = userBalance.add(smallWithdrawAmount).sub(withdrawFee);

      expect(userBalanceAfterWithdraw).to.be.closeTo(expectedBalance, toWantUnit('0.0000001', true));
    });

    xit('should trigger deleveraging on withdraw when LTV is too high', async function () {
      const startingLTV = toWantUnit('0.7');
      await strategy.setTargetLtv(startingLTV);
      const depositAmount = toWantUnit('100', true);

      await vault.connect(self).deposit(depositAmount);
      const ltvBefore = await strategy.calculateLTV();
      console.log(`ltvBefore: ${ltvBefore}`);
      const allowedLTVDrift = toWantUnit('0.01');
      expect(ltvBefore).to.be.closeTo(startingLTV, allowedLTVDrift);
      const newLTV = toWantUnit('0.6');
      await strategy.setTargetLtv(newLTV);
      const smallWithdrawAmount = toWantUnit('1', true);
      const userBalance = await want.balanceOf(selfAddress);
      await vault.connect(self).withdraw(smallWithdrawAmount);
      const userBalanceAfterWithdraw = await want.balanceOf(selfAddress);
      const ltvAfter = await strategy.calculateLTV();
      console.log(`ltvAfter: ${ltvAfter}`);
      expect(ltvAfter).to.be.closeTo(newLTV, allowedLTVDrift);

      const securityFee = 10;
      const percentDivisor = 10000;
      const withdrawFee = smallWithdrawAmount.mul(securityFee).div(percentDivisor);
      const expectedBalance = userBalance.add(smallWithdrawAmount).sub(withdrawFee);

      expect(userBalanceAfterWithdraw).to.be.closeTo(expectedBalance, toWantUnit('0.0000001', true));
    });

    xit('should not change leverage on withdraw when still in the allowed LTV', async function () {
      const startingLTV = toWantUnit('0.7');
      await strategy.setTargetLtv(startingLTV);
      const depositAmount = toWantUnit('100', true);

      await vault.connect(self).deposit(depositAmount);
      const ltvBefore = await strategy.calculateLTV();
      console.log(`ltvBefore: ${ltvBefore}`);
      const allowedLTVDrift = toWantUnit('0.01');
      expect(ltvBefore).to.be.closeTo(startingLTV, allowedLTVDrift);

      const userBalance = await want.balanceOf(selfAddress);
      const smallWithdrawAmount = toWantUnit('0.005', true);
      await vault.connect(self).withdraw(smallWithdrawAmount);
      const userBalanceAfterWithdraw = await want.balanceOf(selfAddress);
      const ltvAfter = await strategy.calculateLTV();
      console.log(`ltvAfter: ${ltvAfter}`);
      expect(ltvAfter).to.be.closeTo(startingLTV, allowedLTVDrift);

      const securityFee = 10;
      const percentDivisor = 10000;
      const withdrawFee = smallWithdrawAmount.mul(securityFee).div(percentDivisor);
      const expectedBalance = userBalance.add(smallWithdrawAmount).sub(withdrawFee);

      expect(userBalanceAfterWithdraw).to.be.closeTo(expectedBalance, toWantUnit('0.0000001', true));
    });

    xit('should allow small withdrawal', async function () {
      const userBalance = await want.balanceOf(selfAddress);
      console.log(`userBalance: ${userBalance}`);
      const depositAmount = toWantUnit('1', true);
      await vault.connect(self).deposit(depositAmount);
      console.log(`await want.balanceOf(selfAddress): ${await want.balanceOf(selfAddress)}`);

      const whaleDepositAmount = toWantUnit('10000', true);
      await vault.connect(wantWhale).deposit(whaleDepositAmount);

      await vault.connect(self).withdrawAll();
      const newUserVaultBalance = await vault.balanceOf(selfAddress);
      console.log(`newUserVaultBalance: ${newUserVaultBalance}`);
      const userBalanceAfterWithdraw = await want.balanceOf(selfAddress);
      const securityFee = 10;
      const percentDivisor = 10000;
      const withdrawFee = (depositAmount * securityFee) / percentDivisor;
      const expectedBalance = userBalance.sub(withdrawFee);
      const smallDifference = depositAmount * 0.00001;
      console.log(`expectedBalance.sub(userBalanceAfterWithdraw): ${expectedBalance.sub(userBalanceAfterWithdraw)}`);
      console.log(`smallDifference: ${smallDifference}`);
      const isSmallBalanceDifference = expectedBalance.sub(userBalanceAfterWithdraw) < smallDifference;
      expect(isSmallBalanceDifference).to.equal(true);
    });

    xit('should handle small deposit + withdraw', async function () {
      const userBalance = await want.balanceOf(selfAddress);
      console.log(`userBalance: ${userBalance}`);
      // "0.0000000000001" for 1e18
      const depositAmount = toWantUnit('0.001', true);

      await vault.connect(self).deposit(depositAmount);
      console.log(`await want.balanceOf(selfAddress): ${await want.balanceOf(selfAddress)}`);

      await vault.connect(self).withdraw(depositAmount);
      console.log(`await want.balanceOf(selfAddress): ${await want.balanceOf(selfAddress)}`);
      const newUserVaultBalance = await vault.balanceOf(selfAddress);
      console.log(`newUserVaultBalance: ${newUserVaultBalance}`);
      const userBalanceAfterWithdraw = await want.balanceOf(selfAddress);
      const securityFee = 10;
      const percentDivisor = 10000;
      const withdrawFee = (depositAmount * securityFee) / percentDivisor;
      const expectedBalance = userBalance.sub(withdrawFee);
      const isSmallBalanceDifference = expectedBalance.sub(userBalanceAfterWithdraw) < 100;
      console.log(`expectedBalance: ${expectedBalance}`);
      console.log(`userBalanceAfterWithdraw: ${userBalanceAfterWithdraw}`);
      // expect(isSmallBalanceDifference).to.equal(true);
    });

    xit('should be able to harvest', async function () {
      await vault.connect(self).deposit(toWantUnit(1000, true));
      const estimatedGas = await strategy.estimateGas.harvest();
      console.log(`estimatedGas: ${estimatedGas}`);
      await strategy.connect(self).harvest();
    });

    xit('should provide yield', async function () {
      const timeToSkip = 3600;
      const initialUserBalance = await want.balanceOf(selfAddress);
      console.log(initialUserBalance);
      const depositAmount = initialUserBalance.div(10);

      await vault.connect(self).deposit(depositAmount);
      const initialVaultBalance = await vault.balance();

      await strategy.updateHarvestLogCadence(timeToSkip / 2);

      const numHarvests = 2;
      for (let i = 0; i < numHarvests; i++) {
        await moveTimeForward(timeToSkip);
        await vault.connect(self).deposit(depositAmount);
        await strategy.harvest();
      }

      const finalVaultBalance = await vault.balance();
      expect(finalVaultBalance).to.be.gt(initialVaultBalance);

      const averageAPR = await strategy.averageAPRAcrossLastNHarvests(numHarvests);
      console.log(`Average APR across ${numHarvests} harvests is ${averageAPR} basis points.`);
    });
  });
  describe('Strategy', function () {
    xit('should be able to pause and unpause', async function () {
      await strategy.pause();
      const depositAmount = toWantUnit('.05', true);
      await expect(vault.connect(self).deposit(depositAmount)).to.be.reverted;
      await strategy.unpause();
      await expect(vault.connect(self).deposit(depositAmount)).to.not.be.reverted;
    });

    xit('should be able to panic', async function () {
      const depositAmount = toWantUnit('0.05', true);
      await vault.connect(self).deposit(depositAmount);
      const vaultBalance = await vault.balance();
      const strategyBalance = await strategy.balanceOf();
      await strategy.panic();
      expect(vaultBalance).to.equal(strategyBalance);
      const newVaultBalance = await vault.balance();
      // 1e18 "0.000000001"
      const allowedImprecision = toWantUnit('0.0000001', true);
      // Panic does not updateBalance so the reported balance is 2x
      expect(newVaultBalance.div(2)).to.be.closeTo(vaultBalance, allowedImprecision);
    });

    xit('should be able to retire strategy', async function () {
      const depositAmount = toWantUnit('.05', true);
      await vault.connect(self).deposit(depositAmount);
      const vaultBalance = await vault.balance();
      const strategyBalance = await strategy.balanceOf();
      expect(vaultBalance).to.equal(strategyBalance);
      // Test needs the require statement to be commented out during the test
      await expect(strategy.retireStrat()).to.not.be.reverted;
      const newVaultBalance = await vault.balance();
      const newStrategyBalance = await strategy.balanceOf();
      const allowedImprecision = toWantUnit('0.00000001');
      expect(newVaultBalance).to.be.closeTo(vaultBalance, allowedImprecision);
      expect(newStrategyBalance).to.be.lt(allowedImprecision);
    });

    xit('should be able to retire strategy with no balance', async function () {
      // Test needs the require statement to be commented out during the test
      await expect(strategy.retireStrat()).to.not.be.reverted;
    });

    xit('should be able to estimate harvest', async function () {
      const whaleDepositAmount = toWantUnit('27171', true);
      await vault.connect(wantWhale).deposit(whaleDepositAmount);
      const minute = 60;
      const hour = 60 * minute;
      const day = 24 * hour;
      await moveTimeForward(100 * day);
      await strategy.harvest();
      await moveTimeForward(10 * day);
      await vault.connect(wantWhale).deposit(toWantUnit('1', true));
      const [profit, callFeeToUser] = await strategy.estimateHarvest();
      console.log(`profit: ${profit}`);
      const hasProfit = profit.gt(0);
      const hasCallFee = callFeeToUser.gt(0);
      expect(hasProfit).to.equal(true);
      expect(hasCallFee).to.equal(true);
    });

    xit('should be able to estimate blocks until liquidation', async function () {
      const whaleDepositAmount = toWantUnit('27171', true);
      await vault.connect(wantWhale).deposit(whaleDepositAmount);
      const blocksUntilLiquidation = await strategy.getblocksUntilLiquidation();
      console.log(`blocksUntilLiquidation: ${blocksUntilLiquidation}`);
      expect(blocksUntilLiquidation.gt(0)).to.equal(true);
    });

    xit('should not allow implementation upgrades before timelock has passed', async function () {
      await strategy.initiateUpgradeCooldown();

      const StrategyV2 = await ethers.getContractFactory('TestReaperAutoCompoundScreamLeverageV2');
      await expect(hre.upgrades.upgradeProxy(strategy.address, StrategyV2)).to.be.revertedWith(
        'cooldown not initiated or still active',
      );
    });

    xit('should allow implementation upgrades once timelock has passed', async function () {
      const StrategyV2 = await ethers.getContractFactory('TestReaperAutoCompoundScreamLeverageV2');
      const timeToSkip = (await strategy.UPGRADE_TIMELOCK()).add(10);
      await strategy.initiateUpgradeCooldown();
      await moveTimeForward(timeToSkip.toNumber());
      await hre.upgrades.upgradeProxy(strategy.address, StrategyV2);
    });

    xit('successive upgrades need to initiate timelock again', async function () {
      const StrategyV2 = await ethers.getContractFactory('TestReaperAutoCompoundScreamLeverageV2');
      const timeToSkip = (await strategy.UPGRADE_TIMELOCK()).add(10);
      await strategy.initiateUpgradeCooldown();
      await moveTimeForward(timeToSkip.toNumber());
      await hre.upgrades.upgradeProxy(strategy.address, StrategyV2);

      const StrategyV3 = await ethers.getContractFactory('TestReaperAutoCompoundScreamLeverageV3');
      await expect(hre.upgrades.upgradeProxy(strategy.address, StrategyV3)).to.be.revertedWith(
        'cooldown not initiated or still active',
      );

      await strategy.initiateUpgradeCooldown();
      await expect(hre.upgrades.upgradeProxy(strategy.address, StrategyV3)).to.be.revertedWith(
        'cooldown not initiated or still active',
      );

      await moveTimeForward(timeToSkip.toNumber());
      await hre.upgrades.upgradeProxy(strategy.address, StrategyV3);
    });
  });
});
