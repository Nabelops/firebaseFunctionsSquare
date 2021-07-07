/* eslint-disable camelcase */
import * as functions from "firebase-functions";
import * as crypto from "crypto";

import {
  Client,
  Environment,
  Money,
  CreatePaymentRequest,
  ApiError,
  CreateCustomerRequest,
  CreateCustomerCardRequest,
  RefundPaymentRequest,
  SearchLoyaltyAccountsRequest,
  SearchLoyaltyAccountsRequestLoyaltyAccountQuery,
  LoyaltyAccountMapping,
} from "square";

const env = functions.config().squarev2.env;

const client = new Client({
  environment: env === "Environment.Production" ?
    Environment.Production : Environment.Sandbox,
  accessToken: functions.config().squarev2.token,
});

// export const pendingCompletePayment = functions.firestore
// .document('orders/{orderId}').onCreate((data, context) => {

// })

export const newCreateCustomer = functions.https.onCall((data) => {
  const {customersApi} = client;
  const idempotency_key = crypto.randomBytes(22).toString("hex");
  const body: CreateCustomerRequest = {
    idempotencyKey: idempotency_key,
    referenceId: data.userId,
    emailAddress: data.email,
  };
  return customersApi.createCustomer(body).then((res) => res.result);
});

export const newCreateCustomerCard = functions.https.onCall((data) => {
  const {customersApi} = client;
  const body: CreateCustomerCardRequest = {
    cardNonce: data.nonce,
  };
  return customersApi.createCustomerCard(data.customerId, body)
      .then((res) => res.result);
});

export const createCustomerCreateCardProcessPayment =
functions.https.onCall((data) => {
  const {customersApi} = client;
  const idempotency_key = crypto.randomBytes(22).toString("hex");
  const body: CreateCustomerRequest = {
    idempotencyKey: idempotency_key,
    referenceId: data.userId,
    emailAddress: data.email,
  };
  return customersApi.createCustomer(body).then((custRes) => {
    const response = custRes.result;
    const customer = response.customer;
    if (response.errors) {
      throw new functions.https.HttpsError("unknown", response.errors[0].code);
    } else if (customer?.id) {
      const saveBody: CreateCustomerCardRequest = {
        cardNonce: data.cardNonce,
      };
      return customersApi.createCustomerCard(customer.id, saveBody)
          .then((cardRes) => {
            const card = cardRes.result.card;
            if (card && card.id) {
              const {paymentsApi} = client;
              const bodyAmountMoney: Money = {};
              bodyAmountMoney.amount = BigInt(Math.round(data.amount * 100));
              bodyAmountMoney.currency = "USD";

              const bodyTipMoney: Money = {};
              bodyTipMoney.amount = BigInt(Math.round(data.tipAmount * 100));
              bodyTipMoney.currency = "USD";

              const paymentBody: CreatePaymentRequest = {
                sourceId: card.id,
                idempotencyKey: idempotency_key,
                amountMoney: bodyAmountMoney,
                customerId: customer.id,
                tipMoney: bodyTipMoney,
                note: (data.note || ("" as string)).substr(0, 499),
              };
              return paymentsApi
                  .createPayment(paymentBody)
                  .then((payRes) => {
                    const payment = payRes.result.payment;
                    if (payment) {
                      return {
                        customer,
                        card,
                        payment,
                      };
                    } else {
                      throw new functions.https
                          .HttpsError("unknown", "No payment in response");
                    }
                  })
                  .catch(() => new functions.https
                      .HttpsError("unknown", "failed Payment"));
            } else {
              throw new functions.https.HttpsError("unknown", "No card");
            }
          });
    } else {
      throw new functions.https.HttpsError("unknown", "No customer id");
    }
  });
});

export const newProcessSavedCard = functions.https.onCall((data) => {
  const {paymentsApi} = client;
  const idempotency_key = crypto.randomBytes(22).toString("hex");

  const bodyAmountMoney: Money = {};
  bodyAmountMoney.amount = BigInt(Math.round(data.amount * 100));
  bodyAmountMoney.currency = "USD";

  const bodyTipMoney: Money = {};
  bodyTipMoney.amount = BigInt(Math.round(data.tipAmount * 100));
  bodyTipMoney.currency = "USD";

  const body: CreatePaymentRequest = {
    sourceId: data.cardId,
    idempotencyKey: idempotency_key,
    amountMoney: bodyAmountMoney,
    customerId: data.customerId,
    tipMoney: bodyTipMoney,
    note: (data.note || ("" as string)).substr(0, 499),
  };
  return paymentsApi
      .createPayment(body)
      .then((res) => res.result)
      .catch((error) => {
        if (error instanceof ApiError) {
          const errors = error.result.errors;
          functions.logger.log(errors);
          throw new functions.https.HttpsError("unknown", errors[0].code);
          // const { statusCode, headers } = error;
        }
      });
});

export const newPendingProcessPayment =
functions.https.onCall((data) => {
  const {paymentsApi} = client;
  const idempotency_key = crypto.randomBytes(22).toString("hex");
  const bodyAmountMoney: Money = {};
  bodyAmountMoney.amount = BigInt(Math.round(data.amount * 100));
  bodyAmountMoney.currency = "USD";

  const bodyTipMoney: Money = {};
  bodyTipMoney.amount = BigInt(Math.round(data.tipAmount * 100));
  bodyTipMoney.currency = "USD";

  const body: CreatePaymentRequest = {
    sourceId: data.nonce,
    idempotencyKey: idempotency_key,
    amountMoney: bodyAmountMoney,
  };
  body.tipMoney = bodyTipMoney;
  // body.referenceId = '123456';
  body.note = (data.note || ("" as string)).substr(0, 499);

  return paymentsApi
      .createPayment(body)
      .then((res) => res.result)
      .catch((error) => {
        if (error instanceof ApiError) {
          const errors = error.result;
          functions.logger.log(errors);
          throw new functions.https
              .HttpsError("unknown", errors.errors[0].code);
          // const { statusCode, headers } = error;
        }
      });
});

export const completePayment = functions.https.onCall((data) => {
  functions.logger.info(data);
  const {paymentsApi} = client;
  return paymentsApi
      .completePayment(data.payment_id)
      .then((res) => {
        functions.logger.info(res);
        return res.result;
      })
      .catch((error) => {
        functions.logger.log(error);
        if (error instanceof ApiError) {
          const errors = error.result.errors;
          functions.logger.log(errors);
          throw new functions.https.HttpsError("unknown", errors[0].code);
          // const { statusCode, headers } = error;
        }
      });
});

export const newProcessGiftCard = functions.https.onCall((data) => {
  const {paymentsApi} = client;
  const idempotency_key = crypto.randomBytes(22).toString("hex");
  const bodyAmountMoney: Money = {};
  bodyAmountMoney.amount = BigInt(Math.round(data.amount * 100));
  bodyAmountMoney.currency = "USD";

  const bodyTipMoney: Money = {};
  bodyTipMoney.amount = BigInt(Math.round(data.tipAmount * 100));
  bodyTipMoney.currency = "USD";

  const body: CreatePaymentRequest = {
    sourceId: data.nonce,
    idempotencyKey: idempotency_key,
    amountMoney: bodyAmountMoney,
  };
  body.tipMoney = bodyTipMoney;
  body.autocomplete = false;
  body.acceptPartialAuthorization = true;
  body.note = (data.note || ("" as string)).substr(0, 499);
  return paymentsApi
      .createPayment(body)
      .then((res) => {
        functions.logger.log(res);
        functions.logger.log(res.result);
        return res.result;
      })
      .catch((error) => {
        if (error instanceof ApiError) {
          const errors = error.result.errors;
          functions.logger.log(errors);
          throw new functions.https.HttpsError("unknown", errors[0].code);
          // const { statusCode, headers } = error;
        }
      });
});

export const newRefundPayment = functions.https.onCall((data) => {
  const refundsApi = client.refundsApi;
  const idempotency_key = crypto.randomBytes(22).toString("hex");
  const bodyAmountMoney: Money = {};
  bodyAmountMoney.amount = BigInt(Math.round(data.amount * 100));
  bodyAmountMoney.currency = "USD";
  const body: RefundPaymentRequest = {
    idempotencyKey: idempotency_key,
    paymentId: data.payment_id,
    amountMoney: bodyAmountMoney,
  };
  return refundsApi.refundPayment(body).catch((error) => {
    if (error instanceof ApiError) {
      const errors = error.result.errors;
      functions.logger.log(errors);
      throw new functions.https.HttpsError("unknown", errors[0].code);
      // const { statusCode, headers } = error;
    }
  });
});

export const searchLoyaltyAccount = functions.https.onCall((data) => {
  functions.logger.info(data.phone);
  const loyaltyApi = client.loyaltyApi;
  const mappings: LoyaltyAccountMapping = {
    phoneNumber: data.phone,
  };
  const query: SearchLoyaltyAccountsRequestLoyaltyAccountQuery = {
    mappings: [mappings],
  };
  const body: SearchLoyaltyAccountsRequest = {
    query,
    limit: 1,
  };
  return loyaltyApi
      .searchLoyaltyAccounts(body)
      .then((res) => res.result)
      .catch((err) => err.result);
});
