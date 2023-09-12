'use strict';

const { getModel } = require('./database/model');
const math = require('mathjs');
const randomString = require('random-string');
const { SERVER_PATH } = require('../constants');
const { EXCHANGE_PLAN_INTERVAL_TIME, EXCHANGE_PLAN_PRICE_SOURCE } = require(`${SERVER_PATH}/constants`)
const { getNodeLib } = require(`${SERVER_PATH}/init`);
const { client } = require('./database/redis');
const { getUserByKitId } = require('./user');
const { subscribedToCoin, validatePair, getKitTier, getKitConfig, getAssetsPrices, getQuickTrades, getKitCoin } = require('./common');
const { transferAssetByKitIds, getUserBalanceByKitId } = require('./wallet');
const { sendEmail } = require('../../../mail');
const { MAILTYPE } = require('../../../mail/strings');
const { verifyBearerTokenPromise } = require('./security');
const { Op } = require('sequelize');
const { loggerBroker } = require('../../../config/logger');
const { isArray } = require('lodash');
const BigNumber = require('bignumber.js');
const { paginationQuery, timeframeQuery, orderingQuery } = require('./database/helpers');
const dbQuery = require('./database/query');

const {
	NO_DATA_FOR_CSV,
} = require(`${SERVER_PATH}/messages`);


const calculateStakingRewards = async (stakers, stakePool, earlyUnstake = false) => {
    const rewards = { total: 0 };

    for (const staker of stakers) {

        const annualEarning = (staker.amount * stakePool.apy) / 100;
        const mountlyEarningAmount = annualEarning / 12;

        const stakerCreationDate = moment(staker.created_at);
        const now = moment();

        const totalStakingDays = stakerCreationDate.diff(now, 'days');
        const amountEarned =  (mountlyEarningAmount * totalStakingDays) / 30

        rewards[staker.user_id] = amountEarned;

        if (earlyUnstake) {
            const slashingPrincipleTotal = (staker.amount / stakePool.slashing_principle_percentage) / 100;
            const slashingEarningTotal = (amountEarned / stakePool.slashing_earning_percentage) / 100;

            rewards[staker.user_id] -= slashingPrincipleTotal;
            rewards[staker.user_id] -= slashingEarningTotal;

            // TO DO: Negative Reward Edge Case
        }

        rewards.total += rewards[staker.user_id]
    }


    return rewards;
}

const distributeStakingRewards = async (stakers, rewards, account_id, currency) => {
    for (const staker of stakers) {
        // TO DO: STAKER UNSTAKING STATUS

        await transferAssetByKitIds(account_id, staker.id, currency, rewards[staker.id], 'Admin transfer stake', staker.email, {
		additionalHeaders: {
			'x-forwarded-for': req.headers['x-forwarded-for']
		}

        // TO DO: STAKER CLOSED STATUS

        // TO DO: EDGE CASE WHEN SOME STAKERS FAIL TO GET UNSTAKED FOR SOME REASON
	})
    }
}

const fetchStakers = async (stakePoolId) => {
    return getModel('staker').findAll({ where: { stake_id: stakePoolId } });
}

const validateExchangeStake = (stake) => {
    if (new BigNumber(stake.min_amount).comparedTo(0) !== 1) {
		throw new Error('Stake minimum amount must be bigger than zero.');
	} 
    if (new BigNumber(stake.max_amount).comparedTo(0) !== 1) {
		throw new Error('Stake maximum amount must be bigger than zero.');
	} 
       if (new BigNumber(stake.max_amount).comparedTo(new BigNumber(stake.min_amount)) !== 1) {
		throw new Error('Stake maximum amount cannot be bigger than maximum amount');
	} 
    if (new BigNumber(stake.apy).comparedTo(0) !== 1) {
		throw new Error('Stake apy must be bigger than zero.');
	} 
    if (new BigNumber(stake.duration).comparedTo(0) !== 1) {
		throw new Error('Stake duration must be bigger than zero.');
	} 
}

const getExchangeStakePools = async (opts = {
    limit: null,
    page: null,
    order_by: null,
    order: null,
    start_date: null,
    end_date: null,
    format: null
}) => {
    const pagination = paginationQuery(opts.limit, opts.page);
	const ordering = orderingQuery(opts.order_by, opts.order);
	const timeframe = timeframeQuery(opts.start_date, opts.end_date);

	const query = {
		where: {
			created_at: timeframe,
		},
		order: [ordering],
		...(!opts.format && pagination),
	}

     	
	if (opts.format) {
		return dbQuery.fetchAllRecords('stake', query)
			.then((stakes) => {
				if (opts.format && opts.format === 'csv') {
					if (stakes.data.length === 0) {
						throw new Error(NO_DATA_FOR_CSV);
					}
					const csv = parse(stakes.data, Object.keys(stakes.data[0]));
					return csv;
				} else {
					return stakes;
				}
			});
	} else {
		return dbQuery.findAndCountAllWithRows('stake', query);
	}
};

const createExchangeStakePool = async (stake) => {
	validateExchangeStake(stake);

    const {
        currency,
        account_id,
        duration,
        slashing,
        early_unstake,
        max_amount,
        status,
        onboarding,
    } = stake;
    
    if (status !== 'uninitialized') {
        throw new Error('Status cannot be other than uninitialized when creating stake pool for the first time');
    }

    if (onboarding) {
          throw new Error('Onboarding cannot be true when creating stake pool for the first time');
    }

    if (!duration && (early_unstake || slashing)) {
        throw new Error('Cannot creation stake pool with perpetual duration and early stake set to true');
    }

    if (!subscribedToCoin(currency)) {
           throw new Error('Invalid coin ' + currency);
    }

    const accountOwner = await getUserByKitId(account_id);

    if (!accountOwner) {
        throw new Error('account id does not exist in the server');
    }
    
    const balance = await getUserBalanceByKitId(account_id);
    let symbols = {};

    for (const key of Object.keys(balance)) {
        if (key.includes('balance') && balance[key]) {
            let symbol = key?.split('_')?.[0];
            symbols[symbol] = balance[key];
        }
    }

    if (new BigNumber(symbols[currency]).comparedTo(new BigNumber(max_amount)) !== 1) {
        throw new Error('funding account does not have enough coins for the max amount set for the stake pool');
    }

	return getModel('stake').create(stake, {
		fields: [
			'name',
            'user_id',
            'currency',
            'account_id',
            'apy',
            'duration',
            'slashing',
            'slashing_earning_percentage',
            'slashing_principle_percentage',
            'early_unstake',
            'min_amount',
            'max_amount',
            'status',
            'onboarding',
		]
	});
};

const updateExchangeStakePool = async (id, data) => {
   	const stakePool = await getModel('stake').findOne({ where: { id } });
	if (!stakePool) {
		throw new Error('Stake pool not found');
	}

    const {
        currency,
        name,
        account_id,
        duration,
        slashing,
        early_unstake,
        slashing_principle_percentage,
        slashing_earning_percentage,
        min_amount,
        max_amount,
        status,
        onboarding,
    } = data;
    
    if(status !== 'uninitialized' && (
        (currency && currency !== stakePool.currency)
        || (name && name !== stakePool.name)
        || (account_id && account_id !== stakePool.account_id)
        || (duration && duration !== stakePool.duration)
        || (slashing && slashing !== stakePool.slashing)
        || (early_unstake && early_unstake !== stakePool.early_unstake)
        || (min_amount && min_amount !== stakePool.min_amount)
        || (max_amount && max_amount !== stakePool.max_amount)
        || (slashing_principle_percentage && slashing_principle_percentage !== stakePool.slashing_principle_percentage)
        || (slashing_earning_percentage && slashing_earning_percentage !== stakePool.slashing_earning_percentage)
    )) {
         throw new Error('Cannot modify the fields when the stake pool is not uninitialized');
    }

    if (onboarding && stakePool.status === 'uninitialized') {
          throw new Error('Onboarding cannot be active while the status is uninitialized');
    }
  
    if (status === 'terminated' && !stakePool.status === 'paused') {
          throw new Error('Cannot terminated stake pool while it is not paused');
    }

    if (status === 'terminated') {
        const balance = await getUserBalanceByKitId(accountOwner);
        let symbols = {};
        
        for (const key of Object.keys(balance)) {
            if (key.includes('balance') && balance[key]) {
                let symbol = key?.split('_')?.[0];
                symbols[symbol] = balance[key];
            }
        }

        const stakers = await fetchStakers(stakePool.id);
        const rewards = await calculateStakingRewards(stakers, stakePool);

        if(new BigNumber(symbols[stakePool.currency]).comparedTo(new BigNumber(rewards.total)) !== 1) {
            throw new Error('There is not enough balance in the funding account, You cannot settle this stake pool');
        }
        await distributeStakingRewards(stakers, rewards, stakePool.account_id, stakePool.currency);
       
    }

    const updatedStakePool = {
		...stakePool.get({ plain: true }),
		...Object.fromEntries(Object.entries(data).filter(([_, v]) => v != null)),
	};

	validateExchangeStake(updatedStakePool);

	return stakePool.update(updatedStakePool, {
		fields: [
			'name',
            'user_id',
            'currency',
            'account_id',
            'apy',
            'duration',
            'slashing',
            'slashing_earning_percentage',
            'slashing_principle_percentage',
            'early_unstake',
            'min_amount',
            'max_amount',
            'status',
            'onboarding',
		]
	});
}


const getExchangeStakers = (
    user_id, 
    opts = {
        limit: null,
        page: null,
        order_by: null,
        order: null,
        start_date: null,
        end_date: null,
        format: null
}) => {

}

const createExchangeStaker = async (stake_id, amount, user_id) => {
    const stakePool = await getModel('stake').findOne({ where: { id: stake_id } });
   
    if (!stakePool.onboarding) {
          throw new Error('Stake pool is not active for accepting users');
    }

    if (stakePool.status !== 'active') {
          throw new Error('Cannot stake in a pool what is not active');
    }

    const balance = await getUserBalanceByKitId(stakePool.account_id);
    let symbols = {};

    for (const key of Object.keys(balance)) {
        if (key.includes('balance') && balance[key]) {
            let symbol = key?.split('_')?.[0];
            symbols[symbol] = balance[key];
        }
    }

    if (new BigNumber(symbols[stakePool.currency]).comparedTo(new BigNumber(amount)) !== 1) {
        throw new Error('You do not have enough funds for the amount set');
    }

    if (new BigNumber(amount).comparedTo(new BigNumber(stakePool.max_amount)) === 1) {
        throw new Error('the amount is higher than the max amount set for the stake pool');
    }

    if (new BigNumber(amount).comparedTo(new BigNumber(stakePool.min_amount)) !== 1) {
        throw new Error('the amount is lower than the min amount set for the stake pool');
    }

    const staker = {
        user_id,
        stake_id,
        amount,
        currency: stakePool.currency,
        status: 'staking',
    }

    return getModel('staker').create(staker, {
		fields: [
			'user_id',
            'stake_id',
            'amount',
            'currency',
            'status',
		]
	});
}

const deleteExchangeStaker = (staker_id) => {

}

module.exports = {
	getExchangeStakePools,
    createExchangeStakePool,
    updateExchangeStakePool,
    getExchangeStakers,
    createExchangeStaker,
    deleteExchangeStaker
};