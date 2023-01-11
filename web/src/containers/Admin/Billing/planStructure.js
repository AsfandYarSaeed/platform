import React from 'react';
import _get from 'lodash/get';
import { CheckOutlined } from '@ant-design/icons';

export const planData = {
	basic: {
		title: 'Basic',
		description: 'Get started fast with a basic test exchange',
		icon: 'BASIC_PLAN_BACKGROUND',
		isPopular: false,
		section: [
			{
				title: 'Cloud',
				points: ['Cloud exchange server hosting'],
			},
		],
		services: {
			title: 'Limited features',
			points: [
				'Theme customization',
				'Localization',
				'Custom domain',
				'Add HollaEx plugins',
				'Add custom plugins',
				'Download exchange logs',
				'Full exchange backup',
			],
			hideOnMonthly: false,
			hideActive: false,
		},
		amount: {
			yearly: 75,
			discount: '25%',
			monthly: 100,
			share: '50%',
		},
	},
	crypto: {
		title: 'Crypto Pro',
		description:
			'For those looking to start a crypto-to-crypto exchange business',
		icon: 'CRYPTO_PRO_PLAN_BACKGROUND',
		isPopular: true,
		section: [
			{
				title: 'Cloud',
				points: ['Cloud exchange server hosting'],
			},
		],
		services: {
			title: 'Full features',
			points: [
				'Theme customization',
				'Localization',
				'Custom domain',
				'Add HollaEx plugins',
				'Add custom plugins',
				'Add custom GitHub repo',
				'Team management & roles',
				'Download exchange logs',
				'Full exchange backup',
				'Landing page (homepage)',
				'Remove HollaEx badge',
				'Referral affiliate link',
				'Crypto chat box',
			],
			hideOnMonthly: false,
			hideActive: false,
		},
		asset_pairs: {
			title: 'Asset and pairs',
			points: ['One free custom crypto coin & pair'],
		},
		amount: {
			yearly: 210,
			discount: '30%',
			monthly: 300,
			share: '25%',
		},
	},
	fiat: {
		title: 'Fiat Ramp',
		description:
			'For those that want to start a fiat to crypto exchange that have a bank or fiat payment processor',
		icon: 'FIAT_MASTER_PLAN_BACKGROUND',
		isPopular: false,
		section: [
			{
				title: 'Cloud',
				points: ['Cloud exchange server hosting'],
			},
		],
		services: {
			title: 'Full features',
			points: [
				'Theme customization',
				'Localization',
				'Custom domain',
				'Add HollaEx plugins',
				'Add custom plugins',
				'Add custom GitHub repo',
				'Full management & system',
				'Download exchange logs',
				'Full exchange backup',
				'Landing page (homepage)',
				'Remove HollaEx badge',
				'Referral affiliate link',
				'Crypto chat box',
			],
			hideOnMonthly: false,
			hideActive: false,
		},
		asset_pairs: {
			title: 'Asset and pairs',
			points: [
				'One free custom crypto coin & pair',
				'One free fiat coin & pair',
			],
		},
		integration: {
			title: 'Fiat integration & KYC system',
			points: [
				'Add fiat bank or payment ramp',
				'Know your customer (KYC) system',
			],
		},
		amount: {
			yearly: 850,
			discount: '35%',
			monthly: 1000,
			share: '15%',
		},
	},
};

const PlanStructure = ({
	exchange,
	typeData = {},
	isMonthly,
	planType,
	showConfigIcon = false,
	handleConfigPlan,
	handleSelect,
	priceData,
	selectedType,
	setSelectedType,
	className,
	dataType,
}) => {
	const { type, background } = typeData;
	const planPriceData = priceData[dataType.type];

	return (
		// <div className={ selectedType === type ? `${className} plan-container opacity` :`${className} plan-container`}>
		<div className={`${className} plan-container`}>
			<div>
				<div className={`popular-header-${type}`}>
					{type === 'crypto' ? 'MOST POPULAR' : ''}
				</div>
				<div>
					<div className={`header-container-${type}`}></div>
					<div
						className="header-container"
						style={{ backgroundImage: `url(${background})` }}
					>
						<h2 className="type-center">{type}</h2>
						<h6 className="text-center">
							Get started fast with a basic test exchange
						</h6>
					</div>
				</div>
				<div className="inner-container">
					<div>
						<ul>
							<h6>Cloud</h6>
							<li>Cloud exchange server hosting</li>
						</ul>

						<ul>
							<h6>Full Features</h6>
							<li>Theme customization</li>
							<li>Localization</li>
							<li>Custom domain</li>
							<li>Add HollaEx plugins</li>
							<li>Add custom plugins</li>
							<li>Add Github repo</li>
							<li>Team Management & Roles</li>
							<li>Download Exchange logs</li>
							<li>Full exchange Backup</li>
						</ul>

						<ul>
							<h6>Assets and pairs</h6>
							<li>One free custom crypto coin & pair</li>
						</ul>

						<div className="amount-container">
							{isMonthly ? (
								<div>
									<p className="dollor-size">
										${_get(planPriceData, 'month.price')}
									</p>
									<p>per month</p>
								</div>
							) : (
								<div>
									<p className="dollor-size">
										${_get(planPriceData, 'year.price')}
									</p>
									<p>per year</p>
								</div>
							)}
						</div>
						<div
							className="radio-container"
							onClick={() => setSelectedType(type)}
						>
							{selectedType === type ? (
								<div>
									<CheckOutlined className={'selected-plan'} />
									<div className="selected-status">SELECTED</div>
								</div>
							) : (
								<div>
									<div className="de-select-status"></div>
									<div className="de-select-status-txt">Select</div>
								</div>
							)}
						</div>
					</div>
				</div>
			</div>
		</div>
	);
};

export default PlanStructure;