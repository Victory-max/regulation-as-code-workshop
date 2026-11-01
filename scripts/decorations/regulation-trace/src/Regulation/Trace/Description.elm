module Regulation.Trace.Description exposing (Description)

{-| Decoration schema: the business description of a model element that has no doc comment of
its own, such as a record field ("Contract APR: the annual rate in the cardholder agreement,
in percent") or a case of a choice ("Active duty: verified active military service"). Values
live in `descriptions.json`, keyed by Morphir node ID; fields and cases use child node IDs
(`<Package>:<Module>:<typeName>.type#<fieldOrCaseName>`).
-}


{-| Plain-English business description.
-}
type alias Description =
    String
