module Regulation.Trace.Domain exposing (Domain)

{-| Decoration schema: the business domain that owns a policy entity ("Liquidity Risk",
"Consumer Cards"), as the SME names it. Its tables, views, rules and metrics are placed in that
domain in the catalog, and grouped into the domain's data product. Values live in
`domains.json`, keyed by the entity type's node ID (`<Package>:<Module>:<typeName>.type`).
-}


{-| The owning business domain's name.
-}
type alias Domain =
    String
