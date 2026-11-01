module Morphir.SDK.Decimal exposing
    ( Decimal
    , fromInt, fromFloat, fromString
    , hundred, thousand, million, tenth, hundredth, thousandth, millionth, bps
    , toString
    , add, sub, negate, mul, div, divWithDefault
    , truncate, round
    , gt, gte, eq, neq, lt, lte, compare
    , abs, shiftDecimalLeft, shiftDecimalRight
    , zero, one, minusOne
    )

{-| TYPE-CHECK STUB of Morphir.SDK.Decimal, used only by scripts/morphir-check.js so that
`elm make` can check exhaustiveness and types without the real SDK's package dependencies.
Signatures mirror morphir-elm 2.100.0. The bodies are placeholders and are never executed:
Morphir IR is produced by `morphir-elm make` against the real SDK.
-}


type Decimal
    = Decimal Float


fromInt : Int -> Decimal
fromInt n =
    Decimal (toFloat n)


fromFloat : Float -> Decimal
fromFloat =
    Decimal


fromString : String -> Maybe Decimal
fromString s =
    String.toFloat s |> Maybe.map Decimal


hundred : Int -> Decimal
hundred n =
    fromInt (n * 100)


thousand : Int -> Decimal
thousand n =
    fromInt (n * 1000)


million : Int -> Decimal
million n =
    fromInt (n * 1000000)


tenth : Int -> Decimal
tenth n =
    Decimal (toFloat n / 10)


hundredth : Int -> Decimal
hundredth n =
    Decimal (toFloat n / 100)


thousandth : Int -> Decimal
thousandth n =
    Decimal (toFloat n / 1000)


millionth : Int -> Decimal
millionth n =
    Decimal (toFloat n / 1000000)


bps : Int -> Decimal
bps n =
    Decimal (toFloat n / 10000)


toString : Decimal -> String
toString (Decimal f) =
    String.fromFloat f


add : Decimal -> Decimal -> Decimal
add (Decimal a) (Decimal b) =
    Decimal (a + b)


sub : Decimal -> Decimal -> Decimal
sub (Decimal a) (Decimal b) =
    Decimal (a - b)


negate : Decimal -> Decimal
negate (Decimal a) =
    Decimal -a


mul : Decimal -> Decimal -> Decimal
mul (Decimal a) (Decimal b) =
    Decimal (a * b)


div : Decimal -> Decimal -> Maybe Decimal
div (Decimal a) (Decimal b) =
    if b == 0 then
        Nothing

    else
        Just (Decimal (a / b))


divWithDefault : Decimal -> Decimal -> Decimal -> Decimal
divWithDefault default a b =
    div a b |> Maybe.withDefault default


truncate : Decimal -> Decimal
truncate (Decimal a) =
    Decimal (toFloat (Basics.truncate a))


round : Decimal -> Decimal
round (Decimal a) =
    Decimal (toFloat (Basics.round a))


gt : Decimal -> Decimal -> Bool
gt (Decimal a) (Decimal b) =
    a > b


gte : Decimal -> Decimal -> Bool
gte (Decimal a) (Decimal b) =
    a >= b


eq : Decimal -> Decimal -> Bool
eq (Decimal a) (Decimal b) =
    a == b


neq : Decimal -> Decimal -> Bool
neq (Decimal a) (Decimal b) =
    a /= b


lt : Decimal -> Decimal -> Bool
lt (Decimal a) (Decimal b) =
    a < b


lte : Decimal -> Decimal -> Bool
lte (Decimal a) (Decimal b) =
    a <= b


compare : Decimal -> Decimal -> Order
compare (Decimal a) (Decimal b) =
    Basics.compare a b


abs : Decimal -> Decimal
abs (Decimal a) =
    Decimal (Basics.abs a)


shiftDecimalLeft : Int -> Decimal -> Decimal
shiftDecimalLeft n (Decimal a) =
    Decimal (a / (10 ^ toFloat n))


shiftDecimalRight : Int -> Decimal -> Decimal
shiftDecimalRight n (Decimal a) =
    Decimal (a * (10 ^ toFloat n))


zero : Decimal
zero =
    Decimal 0


one : Decimal
one =
    Decimal 1


minusOne : Decimal
minusOne =
    Decimal -1
