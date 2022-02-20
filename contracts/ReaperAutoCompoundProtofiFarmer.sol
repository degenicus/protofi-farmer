// SPDX-License-Identifier: MIT

import './abstract/ReaperBaseStrategy.sol';
import './interfaces/IUniswapRouter.sol';
import './interfaces/IMasterChef.sol';
import "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";

import "hardhat/console.sol";

pragma solidity 0.8.11;

/**
 * @dev This strategy will farm LPs on Protofi and autocompound rewards
 */
contract ReaperAutoCompoundProtofiFarmer is ReaperBaseStrategy {
    using SafeERC20Upgradeable for IERC20Upgradeable;

    /**
     * @dev Tokens Used:
     * {WFTM} - Required for liquidity routing when doing swaps. Also used to charge fees on yield.
     * {SCREAM} - The reward token for farming
     * {want} - The vault token the strategy is maximizing
     * {cWant} - The Scream version of the want token
     */
    address public constant WFTM = 0x21be370D5312f44cB42ce377BC9b8a0cEF1A4C83;
    address public constant SCREAM = 0xe0654C8e6fd4D733349ac7E09f6f23DA256bF475;
    address public want;

    /**
     * @dev Third Party Contracts:
     * {SPOOKY_ROUTER} - SpookySwap router
     */
    address public constant SPOOKY_ROUTER = 0xF491e7B69E4244ad4002BC14e878a34207E38c29;
    address public constant masterChef = 0xa71f52aee8311c22b6329EF7715A5B8aBF1c6588;

    /**
     * @dev Routes we take to swap tokens
     * {screamToWftmRoute} - Route we take to get from {SCREAM} into {WFTM}.
     * {wftmToWantRoute} - Route we take to get from {WFTM} into {want}.
     */
    address[] public screamToWftmRoute;
    address[] public wftmToWantRoute;

    /**
    * @dev Protofi variables
    * {poolId} - The MasterChef poolId to stake LP token
    */
    uint public poolId;

    /**
     * @dev Strategy variables

    /**
     * {SPIRIT_ROUTER} - SpiritSwap router
     */
    address public constant SPIRIT_ROUTER = 0x16327E3FbDaCA3bcF7E38F5Af2599D2DDc33aE52;

    /**
     * @dev Initializes the strategy. Sets parameters, saves routes, and gives allowances.
     * @notice see documentation for each variable above its respective declaration.
     */
    function initialize(
        address _vault,
        address[] memory _feeRemitters,
        address[] memory _strategists,
        address _want,
        uint _poolId
    ) public initializer {
        __ReaperBaseStrategy_init(_vault, _feeRemitters, _strategists);
        want = _want;
        poolId = _poolId;

        _giveAllowances();
    }

    /**
     * @dev Withdraws funds and sents them back to the vault.
     * It withdraws {want} from Scream
     * The available {want} minus fees is returned to the vault.
     */
    function withdraw(uint256 _withdrawAmount) external {
        uint256 wantBalance = IERC20Upgradeable(want).balanceOf(address(this));

        if (wantBalance < _withdrawAmount) {
            IMasterChef(masterChef).withdraw(poolId, _withdrawAmount - wantBalance);
            wantBalance = IERC20Upgradeable(want).balanceOf(address(this));
        }

        if (wantBalance > _withdrawAmount) {
            wantBalance = _withdrawAmount;
        }

        uint withdrawFee = _withdrawAmount * securityFee / PERCENT_DIVISOR;
        IERC20Upgradeable(want).safeTransfer(vault, wantBalance - withdrawFee);
    }

    /**
     * @dev Returns the approx amount of profit from harvesting.
     *      Profit is denominated in WFTM, and takes fees into account.
     */
    function estimateHarvest() external view override returns (uint256 profit, uint256 callFeeToUser) {
        // uint256 rewards = predictScreamAccrued();
        // if (rewards == 0) {
        //     return (0, 0);
        // }
        // profit = IUniswapRouter(SPOOKY_ROUTER).getAmountsOut(rewards, screamToWftmRoute)[1];
        // uint256 wftmFee = (profit * totalFee) / PERCENT_DIVISOR;
        // callFeeToUser = (wftmFee * callFee) / PERCENT_DIVISOR;
        // profit -= wftmFee;
    }
    
    /**
     * @dev Function to retire the strategy. Claims all rewards and withdraws
     *      all principal from external contracts, and sends everything back to
     *      the vault. Can only be called by strategist or owner.
     *
     * Note: this is not an emergency withdraw function. For that, see panic().
     */
    function retireStrat() external {
        _onlyStrategistOrOwner();
        _claimRewards();
        _swapRewardsToWftm();
        _swapToWant();
    }

    /**
     * @dev Pauses supplied. Withdraws all funds from Scream, leaving rewards behind.
     */
    function panic() external {
        _onlyStrategistOrOwner();

        pause();
    }

    /**
     * @dev Unpauses the strat.
     */
    function unpause() external {
        _onlyStrategistOrOwner();
        _unpause();

        _giveAllowances();

        deposit();
    }

    /**
     * @dev Pauses the strat.
     */
    function pause() public {
        _onlyStrategistOrOwner();
        _pause();
        _removeAllowances();
    }

    /**
     * @dev Function that puts the funds to work.
     * It gets called whenever someone supplied in the strategy's vault contract.
     * It supplies {want} Scream to farm {SCREAM}
     */
    function deposit() public whenNotPaused {
        uint wantBalance = IERC20Upgradeable(want).balanceOf(address(this));
        IMasterChef(masterChef).deposit(poolId, wantBalance);
    }

    /**
     * @dev Calculates the total amount of {want} held by the strategy
     * which is the balance of want + the total amount supplied to Scream.
     */
    function balanceOf() public view override returns (uint256) {
        return balanceOfWant() + balanceOfPool();
    }

    function balanceOfPool() public view returns (uint256) {
        (uint256 _amount, ) = IMasterChef(masterChef).userInfo(
            poolId,
            address(this)
        );
        return _amount;
    }

    /**
     * @dev Calculates the balance of want held directly by the strategy
     */
    function balanceOfWant() public view returns (uint256) {
        return IERC20Upgradeable(want).balanceOf(address(this));
    }

    /**
     * @dev Core function of the strat, in charge of collecting and re-investing rewards.
     * @notice Assumes the deposit will take care of the TVL rebalancing.
     * 1. Claims {SCREAM} from the comptroller.
     * 2. Swaps {SCREAM} to {WFTM}.
     * 3. Claims fees for the harvest caller and treasury.
     * 4. Swaps the {WFTM} token for {want}
     * 5. Deposits.
     */
    function _harvestCore() internal override {
        _claimRewards();
        _swapRewardsToWftm();
        _chargeFees();
        _swapToWant();
        deposit();
    }

    /**
     * @dev Core harvest function.
     * Get rewards from markets entered
     */
    function _claimRewards() internal {
    }

    /**
     * @dev Core harvest function.
     * Swaps {SCREAM} to {WFTM}
     */
    function _swapRewardsToWftm() internal {
        // uint256 screamBalance = IERC20Upgradeable(SCREAM).balanceOf(address(this));
        // if (screamBalance >= minScreamToSell) {
        //     IUniswapRouter(SPOOKY_ROUTER).swapExactTokensForTokensSupportingFeeOnTransferTokens(
        //         screamBalance,
        //         0,
        //         screamToWftmRoute,
        //         address(this),
        //         block.timestamp + 600
        //     );
        // }
    }

    /**
     * @dev Core harvest function.
     * Charges fees based on the amount of WFTM gained from reward
     */
    function _chargeFees() internal {
        uint256 wftmFee = (IERC20Upgradeable(WFTM).balanceOf(address(this)) * totalFee) / PERCENT_DIVISOR;
        if (wftmFee != 0) {
            uint256 callFeeToUser = (wftmFee * callFee) / PERCENT_DIVISOR;
            uint256 treasuryFeeToVault = (wftmFee * treasuryFee) / PERCENT_DIVISOR;
            uint256 feeToStrategist = (treasuryFeeToVault * strategistFee) / PERCENT_DIVISOR;
            treasuryFeeToVault -= feeToStrategist;

            IERC20Upgradeable(WFTM).safeTransfer(msg.sender, callFeeToUser);
            IERC20Upgradeable(WFTM).safeTransfer(treasury, treasuryFeeToVault);
            IERC20Upgradeable(WFTM).safeTransfer(strategistRemitter, feeToStrategist);
        }
    }

    /**
     * @dev Core harvest function.
     * Swaps {WFTM} for {want}
     */
    function _swapToWant() internal {
        if (want == WFTM) {
            return;
        }
        
        uint256 wftmBalance = IERC20Upgradeable(WFTM).balanceOf(address(this));
        if (wftmBalance != 0) {
            IUniswapRouter(SPIRIT_ROUTER).swapExactTokensForTokensSupportingFeeOnTransferTokens(
                wftmBalance,
                0,
                wftmToWantRoute,
                address(this),
                block.timestamp + 600
            );
        }
    }

    /**
     * @dev Gives the necessary allowances to mint cWant, swap rewards etc
     */
    function _giveAllowances() internal {
        uint wantAllowance = type(uint).max - IERC20Upgradeable(want).allowance(address(this), masterChef);
        IERC20Upgradeable(want).safeIncreaseAllowance(
            masterChef,
            wantAllowance
        );
        // IERC20Upgradeable(WFTM).safeIncreaseAllowance(
        //     SPIRIT_ROUTER,
        //     type(uint256).max - IERC20Upgradeable(WFTM).allowance(address(this), SPIRIT_ROUTER)
        // );
        // IERC20Upgradeable(SCREAM).safeIncreaseAllowance(
        //     SPOOKY_ROUTER,
        //     type(uint256).max - IERC20Upgradeable(SCREAM).allowance(address(this), SPOOKY_ROUTER)
        // );
    }

    /**
     * @dev Removes all allowance that were given
     */
    function _removeAllowances() internal {
        // IERC20Upgradeable(want).safeDecreaseAllowance(address(cWant), IERC20Upgradeable(want).allowance(address(this), address(cWant)));
        // IERC20Upgradeable(WFTM).safeDecreaseAllowance(SPIRIT_ROUTER, IERC20Upgradeable(WFTM).allowance(address(this), SPIRIT_ROUTER));
        // IERC20Upgradeable(SCREAM).safeDecreaseAllowance(SPOOKY_ROUTER, IERC20Upgradeable(SCREAM).allowance(address(this), SPOOKY_ROUTER));
    }
}
