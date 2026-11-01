"""DataHub ingestion source for a DuckDB database file.

DataHub has no dedicated DuckDB connector, so this is its generic SQLAlchemy source with the
duckdb-engine dialect and platform `duckdb`. duckdb-engine 0.17 cannot reflect primary,
foreign or unique keys on DuckDB 1.5 (it queries Postgres' REGCLASS type), which makes the
generic source skip every table; the tables declare no keys, so those calls return empty.

Use in a recipe (with scripts/datahub on PYTHONPATH):

    source:
      type: duckdb_source.DuckDBSource
      config:
        connect_uri: "duckdb:///out/enterprise.db?access_mode=read_only"

Needs: pip install 'acryl-datahub[sqlalchemy]' duckdb==1.5.5 duckdb-engine
Dataset names are <file name>.main.<table>, matching the policy metadata in mcps.json.
"""

import duckdb_engine
from datahub.ingestion.source.sql.sql_generic import SQLAlchemyGenericConfig, SQLAlchemyGenericSource

duckdb_engine.Dialect.get_pk_constraint = lambda self, connection, table_name, schema=None, **kw: {"constrained_columns": [], "name": None}
duckdb_engine.Dialect.get_foreign_keys = lambda self, connection, table_name, schema=None, **kw: []
duckdb_engine.Dialect.get_unique_constraints = lambda self, connection, table_name, schema=None, **kw: []


class DuckDBSource(SQLAlchemyGenericSource):
    @classmethod
    def create(cls, config_dict, ctx):
        config = SQLAlchemyGenericConfig.model_validate({"platform": "duckdb", **config_dict})
        return cls(config, ctx)
