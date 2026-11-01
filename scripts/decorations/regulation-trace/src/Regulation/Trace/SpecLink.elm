module Regulation.Trace.SpecLink exposing (SpecLinks, SpecReference)

{-| Decoration schema: links a Morphir type or rule to the specification sections it was
derived from. Values live in `spec-links.json`, keyed by Morphir node ID.
-}


{-| One specification section. `url` is project-relative for downloaded specs
(`specs/<file>.md#<heading-anchor>`) or absolute otherwise. `section` is the section's
identifier and title as it appears in the spec, e.g. "O.D.1: Transactional Accounts".
-}
type alias SpecReference =
    { section : String
    , url : String
    }


{-| All sections a type or rule derives from, most specific first.
-}
type alias SpecLinks =
    List SpecReference
