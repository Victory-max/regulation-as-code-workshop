module Fiction.Bank.CheckingDebit.Rules exposing
    ( atmPaymentLimit
    , checkPaymentLimit
    , checkingBalanceAfter
    , debitDecision
    , debitResult
    , hasValidAmount
    , isOverPaymentLimit
    , isWithinCheckingBalance
    , isWithinCombinedBalance
    , savingsBalanceAfter
    , savingsTransfer
    , shortfall
    , zellePaymentLimit
    )

{-| Fiction Bank checking debit policy.

A payment is debited from checking. Each payment method has a per-payment limit; wire transfers
have none. If checking alone can't cover the payment but checking and savings together can, the
shortfall (and only the shortfall) moves from savings to checking and the payment is made.
Otherwise the payment is rejected. All amounts are in US dollars.

-}

import Fiction.Bank.CheckingDebit.Types exposing (DebitDecision(..), DebitRequest, DebitResult, PaymentMethod(..))
import Morphir.SDK.Decimal as Decimal exposing (Decimal)


{-| Largest payment allowed by check: $10,000. A check for exactly $10,000 is allowed.
-}
checkPaymentLimit : Decimal
checkPaymentLimit =
    Decimal.fromInt 10000


{-| Largest payment allowed at an ATM: $6,000.
-}
atmPaymentLimit : Decimal
atmPaymentLimit =
    Decimal.fromInt 6000


{-| Largest payment allowed by Zelle: $1,000.
-}
zellePaymentLimit : Decimal
zellePaymentLimit =
    Decimal.fromInt 1000


{-| A payment must be for more than zero dollars.
-}
hasValidAmount : DebitRequest -> Bool
hasValidAmount request =
    Decimal.gt request.amount Decimal.zero


{-| Is this payment above the limit for its payment method? Limits apply to each payment and
include the limit itself (exactly the limit is allowed). Wire transfers have no limit.
-}
isOverPaymentLimit : DebitRequest -> Bool
isOverPaymentLimit request =
    case request.paymentMethod of
        Check ->
            Decimal.gt request.amount checkPaymentLimit

        Atm ->
            Decimal.gt request.amount atmPaymentLimit

        Zelle ->
            Decimal.gt request.amount zellePaymentLimit

        Wire ->
            False


{-| Can checking alone cover the payment?
-}
isWithinCheckingBalance : DebitRequest -> Bool
isWithinCheckingBalance request =
    Decimal.lte request.amount request.checkingBalance


{-| Can checking and savings together cover the payment?
-}
isWithinCombinedBalance : DebitRequest -> Bool
isWithinCombinedBalance request =
    Decimal.lte request.amount (Decimal.add request.checkingBalance request.savingsBalance)


{-| How much more the payment needs than checking holds (zero when checking is enough).
-}
shortfall : DebitRequest -> Decimal
shortfall request =
    if isWithinCheckingBalance request then
        Decimal.zero

    else
        Decimal.sub request.amount request.checkingBalance


{-| The bank's decision on a payment. Checked in this order: the amount must be valid, the
payment must be within its method's limit (even when there is enough money), then checking
pays it if it can, otherwise savings covers the shortfall if it can, otherwise it is rejected.
-}
debitDecision : DebitRequest -> DebitDecision
debitDecision request =
    if not (hasValidAmount request) then
        RejectedInvalidAmount

    else if isOverPaymentLimit request then
        RejectedOverPaymentLimit

    else if isWithinCheckingBalance request then
        PaidFromChecking

    else if isWithinCombinedBalance request then
        PaidWithSavingsTransfer

    else
        RejectedInsufficientFunds


{-| How much moves from savings to checking: the shortfall when savings covers it, otherwise
nothing. Savings never moves for a rejected payment.
-}
savingsTransfer : DebitRequest -> Decimal
savingsTransfer request =
    case debitDecision request of
        PaidWithSavingsTransfer ->
            shortfall request

        PaidFromChecking ->
            Decimal.zero

        RejectedInvalidAmount ->
            Decimal.zero

        RejectedOverPaymentLimit ->
            Decimal.zero

        RejectedInsufficientFunds ->
            Decimal.zero


{-| Checking balance after the payment. A paid payment is debited in full, after any savings
transfer; a rejected payment leaves checking unchanged.
-}
checkingBalanceAfter : DebitRequest -> Decimal
checkingBalanceAfter request =
    case debitDecision request of
        PaidFromChecking ->
            Decimal.sub request.checkingBalance request.amount

        PaidWithSavingsTransfer ->
            Decimal.sub (Decimal.add request.checkingBalance (savingsTransfer request)) request.amount

        RejectedInvalidAmount ->
            request.checkingBalance

        RejectedOverPaymentLimit ->
            request.checkingBalance

        RejectedInsufficientFunds ->
            request.checkingBalance


{-| Savings balance after the payment: reduced only by the shortfall transferred to checking.
-}
savingsBalanceAfter : DebitRequest -> Decimal
savingsBalanceAfter request =
    Decimal.sub request.savingsBalance (savingsTransfer request)


{-| The full outcome of a payment: the decision, the savings transfer and both balances after.
-}
debitResult : DebitRequest -> DebitResult
debitResult request =
    { decision = debitDecision request
    , savingsTransfer = savingsTransfer request
    , checkingBalanceAfter = checkingBalanceAfter request
    , savingsBalanceAfter = savingsBalanceAfter request
    }
