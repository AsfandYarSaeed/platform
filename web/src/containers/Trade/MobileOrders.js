import React from 'react';
import classnames from 'classnames';
import TradeBlock from './components/TradeBlock';
import ActiveOrders from './components/ActiveOrders';
import UserTrades from './components/UserTrades';
import { ActionNotification, NotLoggedIn } from 'components';
import STRINGS from 'config/localizedStrings';
import withConfig from 'components/ConfigProvider/withConfig';

const MobileOrders = ({
	activeOrders,
	cancelOrder,
	cancelAllOrders,
	goToTransactionsHistory,
	pair,
	pairData,
	userTrades,
	isLoggedIn,
	pairs,
	coins,
	cancelDelayData,
	icons: ICONS,
	activeOrdersMarket,
}) => (
	<div
		className={classnames(
			'flex-column',
			'd-flex',
			'justify-content-between',
			'f-1',
			'apply_rtl',
			'w-100'
		)}
	>
		<TradeBlock
			title={STRINGS['ORDERS']}
			action={
				isLoggedIn ? (
					<ActionNotification
						text={STRINGS['CANCEL_ALL']}
						iconPath={ICONS['CANCEL_CROSS_ACTIVE']}
						onClick={cancelAllOrders}
						status=""
						showActionText={true}
					/>
				) : (
					''
				)
			}
			className="f-1"
		>
			<NotLoggedIn placeholderKey="NOT_LOGGEDIN.TXT_1" hasBackground={false}>
				<ActiveOrders
					pairs={pairs}
					cancelDelayData={cancelDelayData}
					orders={activeOrders}
					onCancel={cancelOrder}
					onCancelAll={cancelAllOrders}
				/>
			</NotLoggedIn>
		</TradeBlock>
		<TradeBlock
			title={STRINGS['RECENT_TRADES']}
			active={true}
			action={
				isLoggedIn ? (
					<ActionNotification
						text={STRINGS['TRANSACTION_HISTORY.TITLE']}
						iconPath={ICONS['ARROW_TRANSFER_HISTORY_ACTIVE']}
						onClick={() => goToTransactionsHistory('trades')}
						status=""
						showActionText={true}
					/>
				) : (
					''
				)
			}
			className="f-1"
		>
			<NotLoggedIn placeholderKey="NOT_LOGGEDIN.TXT_1" hasBackground={false}>
				<UserTrades
					pageSize={10}
					trades={userTrades}
					pair={pair}
					pairData={pairData}
					lessHeaders={true}
					pairs={pairs}
					coins={coins}
					icons={ICONS}
				/>
			</NotLoggedIn>
		</TradeBlock>
	</div>
);

export default withConfig(MobileOrders);
