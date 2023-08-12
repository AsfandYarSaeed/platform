'use strict';

import { getModel } from './database/model';
import ccxt from 'ccxt';
import randomString from 'random-string';
import {
	EXCHANGE_PLAN_INTERVAL_TIME,
	EXCHANGE_PLAN_PRICE_SOURCE,
} from '../../../constants';
import { getNodeLib } from '../../../init';
import { client } from './database/redis';
import { getUserByKitId } from './user';
import {
	validatePair,
	getKitTier,
	getKitConfig,
	getAssetsPrices,
	getQuickTrades,
	getKitCoin,
} from './common';
import { sendEmail } from '../../../mail';
import { MAILTYPE } from '../../../mail/strings';
import { verifyBearerTokenPromise } from './security';
import { Op } from 'sequelize';
import { loggerBroker } from '../../../config/logger';
import { isArray } from 'lodash';
import BigNumber from 'bignumber.js';
const connectedExchanges: any = {};


import {
	TOKEN_EXPIRED,
	AUTH_NOT_MATCHED,
	BROKER_NOT_FOUND,
	BROKER_SIZE_EXCEED,
	BROKER_PAUSED,
	BROKER_ERROR_DELETE_UNPAUSED,
	BROKER_EXISTS,
	BROKER_FORMULA_NOT_FOUND,
	SPREAD_MISSING,
	MANUAL_BROKER_CREATE_ERROR,
	DYNAMIC_BROKER_CREATE_ERROR,
	DYNAMIC_BROKER_EXCHANGE_PLAN_ERROR,
	DYNAMIC_BROKER_UNSUPPORTED,
	EXCHANGE_NOT_FOUND,
	SYMBOL_NOT_FOUND,
	UNISWAP_PRICE_NOT_FOUND,
	FORMULA_MARKET_PAIR_ERROR,
	COIN_INPUT_MISSING,
	AMOUNTS_MISSING,
	REBALANCE_SYMBOL_MISSING,
	PRICE_NOT_FOUND,
	QUOTE_EXPIRY_TIME_ERROR,
} from '../../../messages';


const validateBrokerPair = (brokerPair) => {
	if (brokerPair.type === 'manual' && new BigNumber(brokerPair.buy_price).comparedTo(0) !== 1) {
		throw new Error('Broker buy price must be bigger than zero.');
	} else if (brokerPair.type === 'manual' && new BigNumber(brokerPair.sell_price).comparedTo(0) !== 1) {
		throw new Error('Broker sell price must be bigger than zero.');
	} else if (new BigNumber(brokerPair.min_size).comparedTo(0) !== 1) {
		throw new Error('Broker minimum order size must be bigger than zero.');
	} else if (new BigNumber(brokerPair.max_size).comparedTo(new BigNumber(brokerPair.min_size)) !== 1) {
		throw new Error('Broker maximum order size must be bigger than minimum order size.');
	} else if (brokerPair.symbol && !validatePair(brokerPair.symbol)) {
		throw new Error('invalid symbol');
	}
};

const setExchange = (data) => {
	if (connectedExchanges[data.id]) {
		return connectedExchanges[data.id].exchange
	}

	const exchangeClass = ccxt[data.exchange];

	const exchange = new exchangeClass({
		timeout: 5000,
		...(data.api_key && { 'apiKey': data.api_key }),
		...(data.api_secret && { 'secret': data.api_secret }),
	})

	if (data.id) {
		connectedExchanges[data.id] = { exchange, api_key: data.api_key, api_secret: data.api_secret };
	}

	return exchange;
}

const getQuoteDynamicBroker = async (side, broker, user_id = null, orderData) => {

	const { symbol, spread, quote_expiry_time, refresh_interval, formula, id } = broker;

	const baseCurrencyPrice = await calculatePrice(side, spread, formula, refresh_interval, id);

	const responseObject: any = {
		price: baseCurrencyPrice
	};

	const { size, receiving_amount, spending_amount } = calculateSize(orderData, side, responseObject, symbol);
	responseObject.receiving_amount = receiving_amount;
	responseObject.spending_amount = spending_amount;

	//check if there is user_id, if so, assing token
	if (user_id) {

		// Generate randomToken to be used during deal execution
		const randomToken = generateRandomToken(user_id, symbol, side, quote_expiry_time, baseCurrencyPrice, size, 'broker');
		responseObject.token = randomToken;
		// set expiry
		const expiryDate = new Date();
		expiryDate.setSeconds(expiryDate.getSeconds() + quote_expiry_time || 30);
		responseObject.expiry = expiryDate;
	}

	return responseObject;

};

const getQuoteManualBroker = async (broker, side, user_id = null, orderData) => {
	const { symbol, quote_expiry_time, sell_price, buy_price } = broker;

	const baseCurrencyPrice = side === 'buy' ? sell_price : buy_price;

	const responseObject: any = {
		price: baseCurrencyPrice
	};

	const { size, receiving_amount, spending_amount } = calculateSize(orderData, side, responseObject, symbol);
	responseObject.receiving_amount = receiving_amount;
	responseObject.spending_amount = spending_amount;

	if (user_id) {

		const randomToken = generateRandomToken(user_id, symbol, side, quote_expiry_time, baseCurrencyPrice, size, 'broker');
		responseObject.token = randomToken;
		// set expiry
		const expiryDate = new Date();
		expiryDate.setSeconds(expiryDate.getSeconds() + quote_expiry_time || 30);
		responseObject.expiry = expiryDate;
	}
	return responseObject;
}

const calculateSize = (orderData, side, responseObject, symbol) => {
	if (orderData == null) {
		throw new Error(COIN_INPUT_MISSING);
	}

	let size = null;
	let { spending_currency, receiving_currency, spending_amount, receiving_amount } = orderData;

	const coins = symbol.split('-');
	const baseCoinInfo = getKitCoin(coins[0]);
	const quoteCointInfo = getKitCoin(coins[1]);

	if (spending_currency == null && receiving_currency == null) {
		throw new Error(AMOUNTS_MISSING);
	}

	if (spending_amount != null) {
		const incrementUnit = side === 'buy' ? baseCoinInfo.increment_unit : quoteCointInfo.increment_unit;
		const targetedAmount = side === 'buy' ? spending_amount / responseObject.price : spending_amount * responseObject.price;

		if (incrementUnit < 1) {
			const decimalPoint = new BigNumber(incrementUnit).dp();
			const sourceAmount = new BigNumber(targetedAmount).decimalPlaces(decimalPoint).toNumber();
			receiving_amount = sourceAmount;
		} else {
			receiving_amount = targetedAmount - (targetedAmount % incrementUnit);
		}


	} else if (receiving_amount != null) {
		const incrementUnit = side === 'buy' ? quoteCointInfo.increment_unit : baseCoinInfo.increment_unit
		const targetedAmount = side === 'buy' ? receiving_amount * responseObject.price : receiving_amount / responseObject.price;

		if (incrementUnit < 1) {
			const decimalPoint = new BigNumber(incrementUnit).dp();
			const sourceAmount = new BigNumber(targetedAmount).decimalPlaces(decimalPoint).toNumber();
			spending_amount = sourceAmount;
		} else {
			spending_amount = targetedAmount - (targetedAmount % incrementUnit);
		}
	}

	if (`${spending_currency}-${receiving_currency}` === symbol) {
		size = spending_amount;
	} else {
		size = receiving_amount
	}
	return { size, spending_amount, receiving_amount };
}


const calculateFormula = (fn) => {
	return new Function(`return ${fn}`)();
}

const isFairPriceForBroker = async (broker) => {
	if (broker.type !== 'dynamic') return true;

	// with ccxt
	const priceFromMarkets = await calculatePrice(null, null, broker.formula, null, broker.id, false);
	// with oracle
	const priceFromOracle = await calculatePrice(null, null, broker.formula, null, broker.id, true);

	//relative difference
	const percDiff = 100 * Math.abs((priceFromMarkets - priceFromOracle) / ((priceFromMarkets + priceFromOracle) / 2));

	// If difference more than 10 percent, price is not fair.
	const priceDifferenceTreshold = 10;
	if (priceFromOracle !== -1 && percDiff > priceDifferenceTreshold) return false;
	else return true;
}

const calculatePrice = async (side, spread, formula, refresh_interval, brokerId, isOracle = false) => {
	const regex = /([a-zA-Z]+(?:_[a-zA-Z]+)+(?:-[a-zA-Z]+))/g;
	const variables = formula.match(regex);

	if (!isArray(variables))
		throw new Error(FORMULA_MARKET_PAIR_ERROR);

	for (let variable of variables) {
		const exchangePair = variable.split('_');
		const exchangeInfo = getKitConfig().info;

		if (exchangePair?.length !== 2)
			throw new Error(FORMULA_MARKET_PAIR_ERROR + ' ' + exchangePair);

		if (!(EXCHANGE_PLAN_PRICE_SOURCE[exchangeInfo.plan] || [])?.includes(exchangePair[0]))
			throw new Error(DYNAMIC_BROKER_UNSUPPORTED);

		const selectedExchange = exchangePair[0] !== 'oracle' && setExchange({ id: `${exchangePair[0]}-broker:fetch-markets`, exchange: exchangePair[0] });
		let marketPrice;

		if (!isOracle && exchangePair[0] !== 'oracle') {
			const formattedSymbol = exchangePair[1].split('-').join('/').toUpperCase();
			const userCachekey = `${brokerId}-${exchangePair[1]}`;
			marketPrice = await client.getAsync(userCachekey);

			if (!marketPrice) {
				const ticker = await selectedExchange.fetchTicker(formattedSymbol);
				marketPrice = ticker.last
				if (refresh_interval)
					client.setexAsync(userCachekey, refresh_interval, ticker.last);
			}
		}
		else {
			const coins = exchangePair[1].split('-');
			const userCachekey = `${brokerId}-${exchangePair[0]}-${exchangePair[1]}`;
			marketPrice = await client.getAsync(userCachekey);

			if (!marketPrice) {
				const conversions = await getAssetsPrices([coins[0]], coins[1], 1);
				marketPrice = conversions[coins[0]];
				if (refresh_interval)
					client.setexAsync(userCachekey, refresh_interval, marketPrice);
			}
			if (marketPrice === -1) return -1;
		}
		formula = formula.replace(variable, marketPrice);

	}
	let convertedPrice = calculateFormula(formula);

	if (side === 'buy') {
		convertedPrice = new BigNumber(convertedPrice).multipliedBy((1 + (spread / 100))).toNumber();
	} else if (side === 'sell') {
		convertedPrice = new BigNumber(convertedPrice).multipliedBy((1 - (spread / 100))).toNumber();
	}

	return convertedPrice;
};

const generateRandomToken = (user_id, symbol, side, expiryTime = 30, price, size, type) => {
	// Generate random token
	const randomToken = randomString({
		length: 32,
		numeric: true,
		letters: true
	});

	// set the generated token along with trade data in Redis expiry time(quote_expiry_time)
	const tradeData = {
		user_id,
		symbol,
		price,
		side,
		size,
		type
	};

	client.setexAsync(randomToken, expiryTime, JSON.stringify(tradeData));
	return randomToken;
};

const fetchBrokerQuote = async (brokerQuote) => {
	const { symbol, side, bearerToken, ip, orderData } = brokerQuote;

	try {
		let user_id = null;
		if (bearerToken) {
			const auth: any = await verifyBearerTokenPromise(bearerToken, ip);
			if (auth) {
				user_id = auth.sub.id;
			}
		}

		// Get the broker record
		const broker = await getModel('broker').findOne({ where: { symbol } });

		if (!broker) {
			throw new Error(BROKER_NOT_FOUND);
		} else if (broker.paused) {
			throw new Error(BROKER_PAUSED);
		}
		if (broker.type === 'dynamic') {
			return getQuoteDynamicBroker(side, broker, user_id, orderData);
		} else {
			return getQuoteManualBroker(broker, side, user_id, orderData);
		}

	} catch (err) {
		throw new Error(err);
	}
};

const testBroker = async (data) => {
	const { formula, spread } = data;
	try {
		if (spread == null) {
			throw new Error(BROKER_FORMULA_NOT_FOUND);
		}

		if (spread == null) {
			throw new Error(SPREAD_MISSING);
		}

		const price = await calculatePrice(
			null,
			spread,
			formula,
			5,
			'test:broker'
		);

		if (price < 0) {
			throw new Error(PRICE_NOT_FOUND);
		}

		const decimalPoint = new BigNumber(price).dp();
		return {
			buy_price: new BigNumber(price * (1 - (spread / 100))).decimalPlaces(decimalPoint).toNumber(),
			sell_price: new BigNumber(price * (1 + (spread / 100))).decimalPlaces(decimalPoint).toNumber()
		}
	} catch (err) {
		throw new Error(err);
	}

};
const testBrokerUniswap = async (data) => {
	const { base_coin, spread, quote_coin } = data;
	const UNISWAP_COINS = {}
	try {
		if (!base_coin || !quote_coin || !UNISWAP_COINS[base_coin] || !UNISWAP_COINS[quote_coin]) {
			throw new Error(SYMBOL_NOT_FOUND);
		}
		if (!spread) {
			throw new Error(SPREAD_MISSING);
		}

		// const paraSwapMin = constructSimpleSDK({ chainId: 1, axios });
		// const includeDEXS = '[Uniswap V3]';

		// const priceRoute = await paraSwapMin.swap.getRate({
		// 	srcToken: UNISWAP_COINS[base_coin].token,
		// 	srcDecimals: UNISWAP_COINS[base_coin].decimals,
		// 	destToken: UNISWAP_COINS[quote_coin].token,
		// 	destDecimals: UNISWAP_COINS[quote_coin].decimals,
		// 	amount: Math.pow(10, UNISWAP_COINS[base_coin].decimals),
		// 	side: SwapSide.SELL,
		// 	includeDEXS
		//   })

		// if (!priceRoute.destAmount) {
		// 	throw new Error(UNISWAP_PRICE_NOT_FOUND)
		// }

		// const price = math.divide(priceRoute.destAmount,Math.pow(10, UNISWAP_COINS[quote_coin].decimals))

		return {
			// buy_price: price * (1 - (spread / 100)),
			// sell_price: price * (1 + (spread / 100))
		}
	} catch (err) {
		throw new Error(err);
	}

};

const testRebalance = async (data) => {
	const { exchange_id, api_key, api_secret } = data;

	try {
		const exchange = setExchange({ exchange: exchange_id, api_key, api_secret })
		const userBalance = await exchange.fetchBalance();
		return userBalance;
	} catch (err) {
		throw new Error(err);
	}

};

const reverseTransaction = async (orderData) => {
	const { symbol, side, size } = orderData;
	const notifyUser = async (data, userId) => {
		const user = await getUserByKitId(userId);
		sendEmail(
			MAILTYPE.ALERT,
			user.email,
			{
				type: 'binance order info',
				data
			},
			user.settings
		);
	};

	try {
		const broker = await getModel('broker').findOne({ where: { symbol } });

		const quickTrades = getQuickTrades();
		const quickTradeConfig = quickTrades.find(quickTrade => quickTrade.symbol === symbol);

		if (quickTradeConfig && quickTradeConfig.type === 'broker' && quickTradeConfig.active && broker && !broker.paused && broker.account) {
			const objectKeys = Object.keys(broker.account);
			const exchangeKey = objectKeys[0];

			if (exchangeKey) {
				const exchange = setExchange({
					exchange: exchangeKey,
					api_key: broker.account[exchangeKey].apiKey,
					api_secret: broker.account[exchangeKey].apiSecret
				})

				const formattedRebalancingSymbol = broker.rebalancing_symbol && broker.rebalancing_symbol.split('-').join('/').toUpperCase();
				exchange.createOrder(formattedRebalancingSymbol, 'market', side, size)
					.catch((err) => { notifyUser(err.message, broker.user_id); });
			}
		}
	} catch (err) {
		loggerBroker.error(err);
	}

};

const createBrokerPair = async (brokerPair) => {
	validateBrokerPair(brokerPair);

	return getModel('broker')
		.findOne({
			where: {
				[Op.or]: [
					{ symbol: brokerPair.symbol },
					{ symbol: brokerPair.symbol.split('-').reverse().join('-') }
				]
			}
		})
		.then(async (deal) => {
			if (deal) {
				throw new Error(BROKER_EXISTS);
			}
			const exchangeInfo = getKitConfig().info;

			const {
				spread,
				quote_expiry_time,
				type,
				account,
				formula,
				rebalancing_symbol
			} = brokerPair;

			if (type !== 'manual' && (!spread || !quote_expiry_time || !formula)) {
				throw new Error(DYNAMIC_BROKER_CREATE_ERROR);
			}

			if (quote_expiry_time < 10) {
				throw new Error(QUOTE_EXPIRY_TIME_ERROR);
			}

			if (type !== 'manual' && exchangeInfo.plan === 'basic') {
				throw new Error(DYNAMIC_BROKER_EXCHANGE_PLAN_ERROR);
			}

			if (type === 'dynamic') {
				brokerPair.refresh_interval = EXCHANGE_PLAN_INTERVAL_TIME[exchangeInfo.plan] || 60;
			}

			if (account) {
				for (const [key, value] of Object.entries(account)) {
					if (!value.hasOwnProperty('apiKey')) {
						// @ts-ignore
						value.apiKey = brokerPair?.account[key]?.apiKey;
					}

					if (!value.hasOwnProperty('apiSecret')) {
						// @ts-ignore
						value.apiSecret = brokerPair?.account[key]?.apiSecret;
					}
				}

				if (!rebalancing_symbol) {
					throw new Error(REBALANCE_SYMBOL_MISSING);
				}
			}

			if (formula) {
				const brokerPrice = await testBroker({ formula, spread });
				if (!Number(brokerPrice.sell_price) || !Number(brokerPrice.buy_price)) {
					throw new Error(FORMULA_MARKET_PAIR_ERROR);
				}
			}

			const newBrokerObject = {
				...brokerPair
			};


			return getModel('broker').create(newBrokerObject, { raw: true });
		});
};

const fetchBrokerPair = (symbol) => {
	return getModel('broker').findOne({ where: { symbol } });
};

const fetchBrokerPairs = async (attributes) => {
	const brokers = await getModel('broker').findAll({ attributes });
	brokers.forEach(broker => {
		for (const [key, value] of Object.entries(broker.account || [])) {
			// @ts-ignore
			value.apiKey = '*****',
				// @ts-ignore
				value.apiSecret = '*********'
		}
	})

	return brokers;
}

const updateBrokerPair = async (id, data) => {
	const brokerPair = await getModel('broker').findOne({ where: { id } });
	if (!brokerPair) {
		throw new Error(BROKER_NOT_FOUND);
	}

	const {
		spread,
		type,
		account,
		formula,
		rebalancing_symbol,
		quote_expiry_time
	} = data;

	const exchangeInfo = getKitConfig().info;

	if (type !== 'manual' && exchangeInfo.plan === 'basic') {
		throw new Error(DYNAMIC_BROKER_EXCHANGE_PLAN_ERROR);
	}
	if (quote_expiry_time < 10) {
		throw new Error(QUOTE_EXPIRY_TIME_ERROR);
	}


	if (type === 'dynamic') {
		data.refresh_interval = EXCHANGE_PLAN_INTERVAL_TIME[exchangeInfo.plan] || 60;
	}

	if (account) {
		for (const [key, value] of Object.entries(account)) {
			// @ts-ignore
			if (!value.hasOwnProperty('apiKey') || value?.apiKey?.includes('*****')) {
				// @ts-ignore
				value.apiKey = brokerPair?.account[key]?.apiKey;
			}
			// @ts-ignore
			if (!value.hasOwnProperty('apiSecret') || value?.apiSecret?.includes('*********')) {
				// @ts-ignore
				value.apiSecret = brokerPair?.account[key]?.apiSecret;
			}
		}

		if (!rebalancing_symbol) {
			throw new Error(REBALANCE_SYMBOL_MISSING);
		}
	}

	if (formula) {
		const brokerPrice = await testBroker({ formula, spread });
		if (!Number(brokerPrice.sell_price) || !Number(brokerPrice.buy_price)) {
			throw new Error(FORMULA_MARKET_PAIR_ERROR);
		}
	}

	const updatedPair = {
		...brokerPair.get({ plain: true }),
		...data,
	};

	validateBrokerPair(updatedPair);

	return brokerPair.update(updatedPair, {
		fields: [
			'user_id',
			'buy_price',
			'sell_price',
			'min_size',
			'max_size',
			'paused',
			'type',
			'quote_expiry_time',
			'rebalancing_symbol',
			'account',
			'formula',
			'spread',
		]
	});
};

const fetchTrackedExchangeMarkets = async (exchange) => {
	const selectedExchage = setExchange({ id: `${exchange}-broker:fetch-markets`, exchange });
	return selectedExchage.fetchMarkets();
}

const deleteBrokerPair = async (id) => {
	const brokerPair = await getModel('broker').findOne({ where: { id } });

	if (!brokerPair) {
		throw new Error(BROKER_NOT_FOUND);
	} else if (!brokerPair.paused) {
		throw new Error(BROKER_ERROR_DELETE_UNPAUSED);
	}

	return brokerPair.destroy();
};

export {
	createBrokerPair,
	fetchBrokerPair,
	fetchBrokerPairs,
	updateBrokerPair,
	deleteBrokerPair,
	fetchBrokerQuote,
	reverseTransaction,
	testBroker,
	testRebalance,
	generateRandomToken,
	fetchTrackedExchangeMarkets,
	testBrokerUniswap,
	isFairPriceForBroker,
	calculatePrice
};