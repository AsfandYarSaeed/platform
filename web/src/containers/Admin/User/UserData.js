import React from 'react';
import { SubmissionError } from 'redux-form';
import { updateUserData } from './actions';
import { AdminHocForm } from '../../../components';
import { COUNTRIES_OPTIONS } from 'utils/countries';

const Form = AdminHocForm('USER_DATA', 'user_data');

const AddressFields = {
	country: {
		type: 'select',
		label: 'Country',
		options: COUNTRIES_OPTIONS,
	},
	address: {
		type: 'text',
		label: 'Address',
	},
	postal_code: {
		type: 'text',
		label: 'Postal Code',
	},
	city: {
		type: 'text',
		label: 'City',
	},
};

const DataFields = {
	email: {
		type: 'text',
		label: 'Email',
		disabled: true,
	},
	full_name: {
		type: 'text',
		label: 'Full Name',
	},
	gender: {
		type: 'select',
		label: 'Gender',
		options: ['Man', 'Woman'],
	},
	nationality: {
		type: 'select',
		label: 'nationality',
		options: COUNTRIES_OPTIONS,
	},
	dob: {
		type: 'date',
		label: 'Date of birth',
	},
	phone_number: {
		type: 'text',
		label: 'Phone Number',
	},
};

const Fields = {
	...DataFields,
	...AddressFields,
};

const onSubmit = (onChangeSuccess, handleClose) => (values) => {
	const submitData = {
		id: values.id,
		address: {},
	};

	Object.keys(DataFields).forEach((key) => {
		if (key === 'gender') {
			submitData[key] = values[key] === 'Woman';
		} else {
			submitData[key] = values[key];
		}
	});
	Object.keys(AddressFields).forEach((key) => {
		submitData.address[key] = values[key];
	});
	return updateUserData(submitData)
		.then((data) => {
			if (onChangeSuccess) {
				onChangeSuccess({
					...values,
					...submitData,
					...data,
				});
			}
			handleClose();
		})
		.catch((err) => {
			throw new SubmissionError({ _error: err.data.message });
		});
};

const generateInitialValues = (initialValues) => {
	const values = {
		...initialValues,
		...initialValues.address,
		gender: initialValues.gender ? 'Woman' : 'Man',
	};
	return values;
};

const UserData = ({
	initialValues,
	readOnly = false,
	onChangeSuccess,
	handleClose,
	handleNav,
}) => {
	const renderEditPopup = () => {
		return (
			<span className="text-underline" onClick={() => handleNav('email')}>
				Edit
			</span>
		);
	};

	const fieldsData = {
		...Fields,
		email: {
			...Fields.email,
			suffix: renderEditPopup(),
		},
	};

	return (
		<Form
			onSubmit={onSubmit(onChangeSuccess, handleClose)}
			buttonText="SAVE"
			fields={fieldsData}
			initialValues={generateInitialValues(initialValues)}
			buttonClass="green-btn"
		/>
	);
};

export default UserData;
