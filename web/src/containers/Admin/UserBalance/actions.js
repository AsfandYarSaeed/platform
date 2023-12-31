import { requestAuthenticated } from '../../../utils';

const handleError = (err) => err.data;

export const requestUserBalance = (id) =>
	requestAuthenticated(`/admin/user/balance?user_id=${id}`)
		.catch(handleError)
		.then((data) => {
			return data;
		});

export const generateCryptoAddress = (paramOptions) =>
	requestAuthenticated(`/admin/user/wallet`, paramOptions)
		.catch(handleError)
		.then((data) => {
			return data;
		});
