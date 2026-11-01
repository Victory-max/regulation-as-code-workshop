module Morphir.SDK.LocalDate exposing
    ( LocalDate
    , diffInDays, diffInWeeks, diffInMonths, diffInYears
    , addDays, addWeeks, addMonths, addYears
    , fromCalendarDate, fromISO, fromOrdinalDate, fromParts
    , toISOString, monthToInt, intToMonth
    , DayOfWeek(..), dayOfWeek, isWeekend, isWeekday
    , Month(..)
    , year, month, monthNumber, day
    )

{-| TYPE-CHECK STUB of Morphir.SDK.LocalDate (see Decimal.elm in this folder for why).
Signatures mirror morphir-elm 2.100.0; bodies are placeholders that are never executed.
-}


type LocalDate
    = LocalDate Int


type DayOfWeek
    = Monday
    | Tuesday
    | Wednesday
    | Thursday
    | Friday
    | Saturday
    | Sunday


type Month
    = January
    | February
    | March
    | April
    | May
    | June
    | July
    | August
    | September
    | October
    | November
    | December


diffInDays : LocalDate -> LocalDate -> Int
diffInDays (LocalDate a) (LocalDate b) =
    b - a


diffInWeeks : LocalDate -> LocalDate -> Int
diffInWeeks a b =
    diffInDays a b // 7


diffInMonths : LocalDate -> LocalDate -> Int
diffInMonths a b =
    diffInDays a b // 30


diffInYears : LocalDate -> LocalDate -> Int
diffInYears a b =
    diffInDays a b // 365


addDays : Int -> LocalDate -> LocalDate
addDays n (LocalDate a) =
    LocalDate (a + n)


addWeeks : Int -> LocalDate -> LocalDate
addWeeks n =
    addDays (n * 7)


addMonths : Int -> LocalDate -> LocalDate
addMonths n =
    addDays (n * 30)


addYears : Int -> LocalDate -> LocalDate
addYears n =
    addDays (n * 365)


fromCalendarDate : Int -> Month -> Int -> LocalDate
fromCalendarDate y m d =
    LocalDate (y * 372 + monthToInt m * 31 + d)


fromISO : String -> Maybe LocalDate
fromISO _ =
    Nothing


fromOrdinalDate : Int -> Int -> LocalDate
fromOrdinalDate y d =
    LocalDate (y * 372 + d)


fromParts : Int -> Int -> Int -> Maybe LocalDate
fromParts y m d =
    Just (LocalDate (y * 372 + m * 31 + d))


toISOString : LocalDate -> String
toISOString (LocalDate a) =
    String.fromInt a


monthToInt : Month -> Int
monthToInt m =
    case m of
        January ->
            1

        February ->
            2

        March ->
            3

        April ->
            4

        May ->
            5

        June ->
            6

        July ->
            7

        August ->
            8

        September ->
            9

        October ->
            10

        November ->
            11

        December ->
            12


intToMonth : Int -> Maybe Month
intToMonth n =
    List.drop (n - 1) [ January, February, March, April, May, June, July, August, September, October, November, December ]
        |> List.head


dayOfWeek : LocalDate -> DayOfWeek
dayOfWeek _ =
    Monday


isWeekend : LocalDate -> Bool
isWeekend d =
    dayOfWeek d == Saturday || dayOfWeek d == Sunday


isWeekday : LocalDate -> Bool
isWeekday d =
    not (isWeekend d)


year : LocalDate -> Int
year (LocalDate a) =
    a // 372


month : LocalDate -> Month
month (LocalDate a) =
    intToMonth (modBy 372 a // 31) |> Maybe.withDefault January


monthNumber : LocalDate -> Int
monthNumber d =
    monthToInt (month d)


day : LocalDate -> Int
day (LocalDate a) =
    modBy 31 a
