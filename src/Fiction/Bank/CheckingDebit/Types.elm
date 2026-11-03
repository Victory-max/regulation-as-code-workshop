module Fiction.Bank.CheckingDebit.Types exposing (DebitDecision(..), DebitRequest, DebitResult, PaymentMethod(..))

{-| The business terms of the checking debit policy. All amounts are in US dollars.
-}

import Morphir.SDK.Decimal exposing (Decimal)


{-| How the customer is paying: by check, at an ATM, by Zelle, or by wire transfer.
Each method has its own per-payment limit.
-}
type PaymentMethod
    = Check
    | Atm
    | Zelle
    | Wire


{-| One payment to be debited from a customer's checking account, with the balances of the
customer's checking and linked savings accounts at the time of the payment.
-}
type alias DebitRequest =
    { requestId : String
    , paymentMethod : PaymentMethod
    , amount : Decimal
    , checkingBalance : Decimal
    , savingsBalance : Decimal
    }


{-| What the bank does with a payment: pay it from checking, pay it after covering the
shortfall from savings, or reject it and say why.
-}
type DebitDecision
    = PaidFromChecking
    | PaidWithSavingsTransfer
    | RejectedInvalidAmount
    | RejectedOverPaymentLimit
    | RejectedInsufficientFunds


{-| The outcome of a payment: the decision, how much moved from savings to checking, and the
balances afterwards.
-}
type alias DebitResult =
    { decision : DebitDecision
    , savingsTransfer : Decimal
    , checkingBalanceAfter : Decimal
    , savingsBalanceAfter : Decimal
    }
