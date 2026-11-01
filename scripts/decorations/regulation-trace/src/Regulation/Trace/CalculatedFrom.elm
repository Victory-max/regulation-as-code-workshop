module Regulation.Trace.CalculatedFrom exposing (CalculatedFrom)

{-| Decoration schema: for a field of a calculation record (such as the LRR calculation), the
policy rule that produces its value, by name (`Lrr.LiquidAssets.stockOfEligibleLiquidAssets`). The field is then filled
from that rule's result when the calculation runs, rather than reported. Fields without it are
reported inputs. Values live in `calculated-from.json`, keyed by the field's node ID
(`<Package>:<Module>:<typeName>.type#<fieldName>`).
-}


{-| The producing rule: `<Module>.<rule>`, as listed by the model (e.g. `Lrr.LiquidAssets.stockOfEligibleLiquidAssets`).
-}
type alias CalculatedFrom =
    String
