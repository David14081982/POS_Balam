-- H171 exact reviewable scope. SELECT ONLY: this file cannot clean any data.
-- Scope CTE is reusable to prepare a separately approved transaction.
-- Match reviewed row hash, then export true PK. Markers alone never select rows.
-- Auth, Storage, online receipts, legacy originals and folio counters are preserved.
BEGIN READ ONLY;
SET LOCAL statement_timeout='60s';
SET LOCAL lock_timeout='5s';
SET LOCAL TimeZone='UTC';
SET LOCAL DateStyle='ISO, MDY';
WITH manifest AS (SELECT $h171_manifest$
{
  "version": 2,
  "expected_project_ref": "telohdbvbvsfmwyriflz",
  "sources": [
    "2026-09-13T02:08:22.103717+00:00",
    "2026-09-13T02:19:19.799347+00:00"
  ],
  "actors": [
    {
      "run": "ca80e903-4239-4fde-9a98-a93d163a5190",
      "actor_id": "895b586d-15b7-40ae-8ce1-926492c2a229"
    },
    {
      "run": "2607cae4-404d-48bc-bdfc-6381b9c4a173",
      "actor_id": "eb46cc84-1fe2-4da0-84b6-8332a7ff3bad"
    },
    {
      "run": "8a89fd93-552a-489d-ae6b-e0afabf899e7",
      "actor_id": "272aed8a-fab0-48e0-b2ba-e65d3f0884b9"
    },
    {
      "run": "69237da3-b20c-4a37-93fb-831fd846d867",
      "actor_id": "5d4ea7ba-d175-4b3a-8170-e84f0a8448d4"
    },
    {
      "run": "6d340d65-7e61-486e-9a2f-f189a57bf7ec",
      "actor_id": "fb16c0b5-d9eb-4444-997c-c8e0c49f234b"
    }
  ],
  "sales": [
    {
      "run": "2607cae4-404d-48bc-bdfc-6381b9c4a173",
      "folio": "BG-260912-0002",
      "operation_id": "55dc5ef6-9300-4b20-bae8-5ff9d9e9738d",
      "client_id": "cli-09c8e0ba-c818-472c-af7b-0bdc399dfcd8",
      "actor_id": "eb46cc84-1fe2-4da0-84b6-8332a7ff3bad"
    },
    {
      "run": "2607cae4-404d-48bc-bdfc-6381b9c4a173",
      "folio": "BG-260912-0004",
      "operation_id": "bc088419-d9c5-45c7-b7de-063b70e230bd",
      "client_id": "cli-09c8e0ba-c818-472c-af7b-0bdc399dfcd8",
      "actor_id": "eb46cc84-1fe2-4da0-84b6-8332a7ff3bad"
    },
    {
      "run": "2607cae4-404d-48bc-bdfc-6381b9c4a173",
      "folio": "BG-260912-0007",
      "operation_id": "d50de195-573a-49b3-9e7a-0cf94bf1a4c6",
      "client_id": "cli-09c8e0ba-c818-472c-af7b-0bdc399dfcd8",
      "actor_id": "eb46cc84-1fe2-4da0-84b6-8332a7ff3bad"
    },
    {
      "run": "8a89fd93-552a-489d-ae6b-e0afabf899e7",
      "folio": "BG-260912-0008",
      "operation_id": "3cb959ec-ca9f-4e52-b83e-6d829171634e",
      "client_id": "cli-c6c85a94-12c3-4ec6-9bc9-7fdc0477ef8a",
      "actor_id": "272aed8a-fab0-48e0-b2ba-e65d3f0884b9"
    },
    {
      "run": "8a89fd93-552a-489d-ae6b-e0afabf899e7",
      "folio": "BG-260912-0009",
      "operation_id": "c652df23-8a36-45da-9287-91af1647c94b",
      "client_id": "cli-c6c85a94-12c3-4ec6-9bc9-7fdc0477ef8a",
      "actor_id": "272aed8a-fab0-48e0-b2ba-e65d3f0884b9"
    },
    {
      "run": "8a89fd93-552a-489d-ae6b-e0afabf899e7",
      "folio": "BG-260912-0010",
      "operation_id": "b857ae81-cb1c-41ed-b630-3f4efebe3789",
      "client_id": "cli-c6c85a94-12c3-4ec6-9bc9-7fdc0477ef8a",
      "actor_id": "272aed8a-fab0-48e0-b2ba-e65d3f0884b9"
    },
    {
      "run": "8a89fd93-552a-489d-ae6b-e0afabf899e7",
      "folio": "BG-260912-0014",
      "operation_id": "2bb786c0-3251-4048-871d-b0814ad6289a",
      "client_id": "cli-c6c85a94-12c3-4ec6-9bc9-7fdc0477ef8a",
      "actor_id": "272aed8a-fab0-48e0-b2ba-e65d3f0884b9"
    }
  ],
  "rows": [
    {
      "table_name": "clients",
      "id_hint": "cli-09c8e0ba-c818-472c-af7b-0bdc399dfcd8",
      "expected_md5": "1521d22a8b2dade8f687a4ded4a3b094",
      "run": "2607cae4-404d-48bc-bdfc-6381b9c4a173",
      "proof": "EXACT_MANIFEST"
    },
    {
      "table_name": "clients",
      "id_hint": "cli-4ac858d0-d18f-4533-9b6b-7bfedaa93260",
      "expected_md5": "e03877e9ce5810072b2b74ea2109b027",
      "run": "69237da3-b20c-4a37-93fb-831fd846d867",
      "proof": "SERVER_ACTOR_RECEIPT_AND_RUN"
    },
    {
      "table_name": "clients",
      "id_hint": "cli-9d26e399-dcb8-4ff9-b58d-07c1e932c503",
      "expected_md5": "af54e4d3906f0013656337ea0d5295e5",
      "run": "6d340d65-7e61-486e-9a2f-f189a57bf7ec",
      "proof": "SERVER_ACTOR_RECEIPT_AND_RUN"
    },
    {
      "table_name": "clients",
      "id_hint": "cli-9ffc50f2-4b0e-44d9-9bd1-a01671b351c2",
      "expected_md5": "7fd2652fd45f9230619a90eb1c297298",
      "run": "ca80e903-4239-4fde-9a98-a93d163a5190",
      "proof": "EXACT_MANIFEST"
    },
    {
      "table_name": "clients",
      "id_hint": "cli-c6c85a94-12c3-4ec6-9bc9-7fdc0477ef8a",
      "expected_md5": "89f4fdfc71ccaa6a2c39285ec0196118",
      "run": "8a89fd93-552a-489d-ae6b-e0afabf899e7",
      "proof": "EXACT_MANIFEST"
    },
    {
      "table_name": "exchange_commits",
      "id_hint": "3ba2082f-8e49-45de-8110-7d0f628dff05",
      "expected_md5": "5606760c51cfc80a7544118af085e176",
      "run": "2607cae4-404d-48bc-bdfc-6381b9c4a173",
      "proof": "DEPENDENCY_EXACT_HASH_PARENT_CHECK_REQUIRED"
    },
    {
      "table_name": "exchange_commits",
      "id_hint": "eac348da-0735-4473-82de-fdb32f375abe",
      "expected_md5": "809b925884c7b89c57b51d0a9d585dea",
      "run": "8a89fd93-552a-489d-ae6b-e0afabf899e7",
      "proof": "DEPENDENCY_EXACT_HASH_PARENT_CHECK_REQUIRED"
    },
    {
      "table_name": "exchange_items",
      "id_hint": "113",
      "expected_md5": "a3901dfbec7710264142ab7d7193ca72",
      "run": "2607cae4-404d-48bc-bdfc-6381b9c4a173",
      "proof": "DEPENDENCY_EXACT_HASH_PARENT_CHECK_REQUIRED"
    },
    {
      "table_name": "exchange_items",
      "id_hint": "114",
      "expected_md5": "c82d28fff53b63edf8c2ed7fff992dda",
      "run": "2607cae4-404d-48bc-bdfc-6381b9c4a173",
      "proof": "DEPENDENCY_EXACT_HASH_PARENT_CHECK_REQUIRED"
    },
    {
      "table_name": "exchange_items",
      "id_hint": "115",
      "expected_md5": "ccadc2a402ee20c604862c8dd9b80971",
      "run": "8a89fd93-552a-489d-ae6b-e0afabf899e7",
      "proof": "DEPENDENCY_EXACT_HASH_PARENT_CHECK_REQUIRED"
    },
    {
      "table_name": "exchange_items",
      "id_hint": "116",
      "expected_md5": "df3d60b54d13b837470d7a3594e855e0",
      "run": "8a89fd93-552a-489d-ae6b-e0afabf899e7",
      "proof": "DEPENDENCY_EXACT_HASH_PARENT_CHECK_REQUIRED"
    },
    {
      "table_name": "exchanges",
      "id_hint": "cmb-3ba2082f-8e49-45de-8110-7d0f628dff05",
      "expected_md5": "ac52666e2b137d555f439462329f9788",
      "run": "2607cae4-404d-48bc-bdfc-6381b9c4a173",
      "proof": "EXACT_MANIFEST"
    },
    {
      "table_name": "exchanges",
      "id_hint": "cmb-eac348da-0735-4473-82de-fdb32f375abe",
      "expected_md5": "915cae264ca7986f3bde542fb66f21cf",
      "run": "8a89fd93-552a-489d-ae6b-e0afabf899e7",
      "proof": "EXACT_MANIFEST"
    },
    {
      "table_name": "layaway_liquidation_commits",
      "id_hint": "2bb786c0-3251-4048-871d-b0814ad6289a",
      "expected_md5": "227f1549aca0fd83840b67b1ae3d28d6",
      "run": "8a89fd93-552a-489d-ae6b-e0afabf899e7",
      "proof": "DEPENDENCY_EXACT_HASH_PARENT_CHECK_REQUIRED"
    },
    {
      "table_name": "layaway_liquidation_commits",
      "id_hint": "d50de195-573a-49b3-9e7a-0cf94bf1a4c6",
      "expected_md5": "04e9ffc8fe14a6d98d49b1f162e6398e",
      "run": "2607cae4-404d-48bc-bdfc-6381b9c4a173",
      "proof": "DEPENDENCY_EXACT_HASH_PARENT_CHECK_REQUIRED"
    },
    {
      "table_name": "liquidations",
      "id_hint": "liq-9bd6a6ad-bfa3-4cbd-8af5-0274e12c1fee",
      "expected_md5": "ed64bfa0e55dd9379593fa1d1c3abf6b",
      "run": "2607cae4-404d-48bc-bdfc-6381b9c4a173",
      "proof": "DEPENDENCY_EXACT_HASH_PARENT_CHECK_REQUIRED"
    },
    {
      "table_name": "liquidations",
      "id_hint": "liq-b7e4c766-420f-4ee9-91bd-0d64ef4543e9",
      "expected_md5": "6cf8e1a799540493f3839559cc940503",
      "run": "8a89fd93-552a-489d-ae6b-e0afabf899e7",
      "proof": "DEPENDENCY_EXACT_HASH_PARENT_CHECK_REQUIRED"
    },
    {
      "table_name": "loan_documents",
      "id_hint": "a71c95cd-53b6-421d-9018-8948f077b51c",
      "expected_md5": "860191a3b84c9ec040202fc150c73fc4",
      "run": "8a89fd93-552a-489d-ae6b-e0afabf899e7",
      "proof": "EXACT_MANIFEST"
    },
    {
      "table_name": "loan_documents",
      "id_hint": "fed8cad9-45a8-4e74-b89a-204aa8212251",
      "expected_md5": "5f6f072e1b1e4680bae63abfc470b953",
      "run": "2607cae4-404d-48bc-bdfc-6381b9c4a173",
      "proof": "EXACT_MANIFEST"
    },
    {
      "table_name": "movements",
      "id_hint": "437",
      "expected_md5": "aecab6707e75a04cf860fa2dc4f8ba2c",
      "run": "2607cae4-404d-48bc-bdfc-6381b9c4a173",
      "proof": "DEPENDENCY_EXACT_HASH_PARENT_CHECK_REQUIRED"
    },
    {
      "table_name": "movements",
      "id_hint": "438",
      "expected_md5": "17938b0057e54461b169c73422bf4882",
      "run": "2607cae4-404d-48bc-bdfc-6381b9c4a173",
      "proof": "DEPENDENCY_EXACT_HASH_PARENT_CHECK_REQUIRED"
    },
    {
      "table_name": "movements",
      "id_hint": "439",
      "expected_md5": "a20cbd7d342161971edd811bd5a10699",
      "run": "2607cae4-404d-48bc-bdfc-6381b9c4a173",
      "proof": "DEPENDENCY_EXACT_HASH_PARENT_CHECK_REQUIRED"
    },
    {
      "table_name": "movements",
      "id_hint": "440",
      "expected_md5": "cb616f32198860dcb9e262a918025450",
      "run": "2607cae4-404d-48bc-bdfc-6381b9c4a173",
      "proof": "DEPENDENCY_EXACT_HASH_PARENT_CHECK_REQUIRED"
    },
    {
      "table_name": "movements",
      "id_hint": "441",
      "expected_md5": "87618d1046b59ae422eea9d9f0c2804b",
      "run": "2607cae4-404d-48bc-bdfc-6381b9c4a173",
      "proof": "DEPENDENCY_EXACT_HASH_PARENT_CHECK_REQUIRED"
    },
    {
      "table_name": "movements",
      "id_hint": "442",
      "expected_md5": "1a4787968aca9e2d1b20c5e13d4f165f",
      "run": "2607cae4-404d-48bc-bdfc-6381b9c4a173",
      "proof": "DEPENDENCY_EXACT_HASH_PARENT_CHECK_REQUIRED"
    },
    {
      "table_name": "movements",
      "id_hint": "443",
      "expected_md5": "690726f46f3a2b1f4a61bbd9d7872f62",
      "run": "2607cae4-404d-48bc-bdfc-6381b9c4a173",
      "proof": "DEPENDENCY_EXACT_HASH_PARENT_CHECK_REQUIRED"
    },
    {
      "table_name": "movements",
      "id_hint": "445",
      "expected_md5": "7716faf8fd9c5a751d6c32aa1cd261ec",
      "run": "2607cae4-404d-48bc-bdfc-6381b9c4a173",
      "proof": "DEPENDENCY_EXACT_HASH_PARENT_CHECK_REQUIRED"
    },
    {
      "table_name": "movements",
      "id_hint": "446",
      "expected_md5": "1f9f4002528cbc9eefa6b04e690efefc",
      "run": "8a89fd93-552a-489d-ae6b-e0afabf899e7",
      "proof": "DEPENDENCY_EXACT_HASH_PARENT_CHECK_REQUIRED"
    },
    {
      "table_name": "movements",
      "id_hint": "447",
      "expected_md5": "659c79c07922d6e22dbff8779b5cd303",
      "run": "8a89fd93-552a-489d-ae6b-e0afabf899e7",
      "proof": "DEPENDENCY_EXACT_HASH_PARENT_CHECK_REQUIRED"
    },
    {
      "table_name": "movements",
      "id_hint": "448",
      "expected_md5": "c64dcf6dafa41e9e863064ac86bb5ef1",
      "run": "8a89fd93-552a-489d-ae6b-e0afabf899e7",
      "proof": "DEPENDENCY_EXACT_HASH_PARENT_CHECK_REQUIRED"
    },
    {
      "table_name": "movements",
      "id_hint": "449",
      "expected_md5": "b5157b90fc1baa201021ff1351edb4c0",
      "run": "8a89fd93-552a-489d-ae6b-e0afabf899e7",
      "proof": "DEPENDENCY_EXACT_HASH_PARENT_CHECK_REQUIRED"
    },
    {
      "table_name": "movements",
      "id_hint": "450",
      "expected_md5": "187295213bef6d63ea7208d574d64309",
      "run": "8a89fd93-552a-489d-ae6b-e0afabf899e7",
      "proof": "DEPENDENCY_EXACT_HASH_PARENT_CHECK_REQUIRED"
    },
    {
      "table_name": "movements",
      "id_hint": "451",
      "expected_md5": "41cf4c3fd98c43ee61d4b157da8eb7c6",
      "run": "8a89fd93-552a-489d-ae6b-e0afabf899e7",
      "proof": "DEPENDENCY_EXACT_HASH_PARENT_CHECK_REQUIRED"
    },
    {
      "table_name": "movements",
      "id_hint": "452",
      "expected_md5": "44edfbe6cb3a68ed7219f5d1db5d350e",
      "run": "8a89fd93-552a-489d-ae6b-e0afabf899e7",
      "proof": "DEPENDENCY_EXACT_HASH_PARENT_CHECK_REQUIRED"
    },
    {
      "table_name": "movements",
      "id_hint": "453",
      "expected_md5": "02a5122e6e939fc51b84881389aff162",
      "run": "8a89fd93-552a-489d-ae6b-e0afabf899e7",
      "proof": "DEPENDENCY_EXACT_HASH_PARENT_CHECK_REQUIRED"
    },
    {
      "table_name": "movements",
      "id_hint": "455",
      "expected_md5": "85e4280799e39784c47e1f1d01632cdd",
      "run": "8a89fd93-552a-489d-ae6b-e0afabf899e7",
      "proof": "DEPENDENCY_EXACT_HASH_PARENT_CHECK_REQUIRED"
    },
    {
      "table_name": "products",
      "id_hint": "07e7f317-807e-4382-abd3-517f2f109484",
      "expected_md5": "84f31ab70b161ea3b90f9de487e837fe",
      "run": "2607cae4-404d-48bc-bdfc-6381b9c4a173",
      "proof": "EXACT_MANIFEST"
    },
    {
      "table_name": "products",
      "id_hint": "0abfa7f5-6d8c-4edf-bfc8-0a7e87b0df03",
      "expected_md5": "d107841faadf6199896ef330393b18dd",
      "run": "2607cae4-404d-48bc-bdfc-6381b9c4a173",
      "proof": "EXACT_MANIFEST"
    },
    {
      "table_name": "products",
      "id_hint": "0fca850b-087c-481c-ac05-17e9e058bb7c",
      "expected_md5": "eff64db4a3f35bd65ffda4c0effe5ffb",
      "run": "8a89fd93-552a-489d-ae6b-e0afabf899e7",
      "proof": "EXACT_MANIFEST"
    },
    {
      "table_name": "products",
      "id_hint": "1c329b33-1478-4316-83b2-0c96b73d386f",
      "expected_md5": "44f89d1e9bf0018c87f7c3ee64103a8c",
      "run": "2607cae4-404d-48bc-bdfc-6381b9c4a173",
      "proof": "EXACT_MANIFEST"
    },
    {
      "table_name": "products",
      "id_hint": "3804757b-5bda-404b-8c39-f215b21f2d43",
      "expected_md5": "565eca62b6b23086b9562e68a1bceeeb",
      "run": "8a89fd93-552a-489d-ae6b-e0afabf899e7",
      "proof": "EXACT_MANIFEST"
    },
    {
      "table_name": "products",
      "id_hint": "49d6e6ba-3054-48e3-942d-fd2c6a5678cb",
      "expected_md5": "69f6fb3d35fbdcf54564774214ae74e3",
      "run": "2607cae4-404d-48bc-bdfc-6381b9c4a173",
      "proof": "EXACT_MANIFEST"
    },
    {
      "table_name": "products",
      "id_hint": "6a6375de-ecbf-4824-a062-907c838c36e4",
      "expected_md5": "48d53b653893e48b9a752fa5089b4ce4",
      "run": "8a89fd93-552a-489d-ae6b-e0afabf899e7",
      "proof": "EXACT_MANIFEST"
    },
    {
      "table_name": "products",
      "id_hint": "6cf88a71-9c31-42f1-a446-cc4e27b8ac29",
      "expected_md5": "4f608ab20dddbc16279c5bb7c514792f",
      "run": "2607cae4-404d-48bc-bdfc-6381b9c4a173",
      "proof": "EXACT_MANIFEST"
    },
    {
      "table_name": "products",
      "id_hint": "81e59ebd-fa9d-41f7-81ee-af0a722b9fab",
      "expected_md5": "b13320a8fac1f8ae07e8a05540e7b71b",
      "run": "8a89fd93-552a-489d-ae6b-e0afabf899e7",
      "proof": "EXACT_MANIFEST"
    },
    {
      "table_name": "products",
      "id_hint": "82b8863c-89dd-47be-8b4b-e81c66e202e3",
      "expected_md5": "5ee1c416946ac18ad06f64c7df2d8e38",
      "run": "2607cae4-404d-48bc-bdfc-6381b9c4a173",
      "proof": "EXACT_MANIFEST"
    },
    {
      "table_name": "products",
      "id_hint": "a7e2bc67-2f72-4e1f-90b2-e72acb8fd7be",
      "expected_md5": "453ebce903e6a8e4861a2ce1d44da431",
      "run": "8a89fd93-552a-489d-ae6b-e0afabf899e7",
      "proof": "EXACT_MANIFEST"
    },
    {
      "table_name": "products",
      "id_hint": "c5a3b49d-f94c-423b-84e1-d02a8d97c4c0",
      "expected_md5": "f51e16c051dd17f7b186de76c18b1977",
      "run": "8a89fd93-552a-489d-ae6b-e0afabf899e7",
      "proof": "EXACT_MANIFEST"
    },
    {
      "table_name": "products",
      "id_hint": "cf187ffb-b033-4c09-a669-8f5a8fdf84fb",
      "expected_md5": "16b346f79f83e80b2cfa25f786c9a7f9",
      "run": "2607cae4-404d-48bc-bdfc-6381b9c4a173",
      "proof": "EXACT_MANIFEST"
    },
    {
      "table_name": "products",
      "id_hint": "eb82cb4c-16c3-4c3c-9662-06323693df84",
      "expected_md5": "4777b5d07f25c477303a9505a6c172f2",
      "run": "8a89fd93-552a-489d-ae6b-e0afabf899e7",
      "proof": "EXACT_MANIFEST"
    },
    {
      "table_name": "promotions",
      "id_hint": "promo-1685ad28-6335-431f-a304-fed01fe182b8",
      "expected_md5": "c050f9a775cffbeb0b6f2697647af11b",
      "run": "6d340d65-7e61-486e-9a2f-f189a57bf7ec",
      "proof": "SERVER_ACTOR_RECEIPT_AND_RUN"
    },
    {
      "table_name": "promotions",
      "id_hint": "promo-1bf1bb50-5d45-480f-829f-b78031a13e4e",
      "expected_md5": "0f3daa33ce18f8dc6ce77a7fe2c4276b",
      "run": "2607cae4-404d-48bc-bdfc-6381b9c4a173",
      "proof": "EXACT_MANIFEST"
    },
    {
      "table_name": "promotions",
      "id_hint": "promo-5627f55b-22d2-46fa-a98e-6c7ff525d95e",
      "expected_md5": "4c990204a8214ec92afa9ff271c4984f",
      "run": "ca80e903-4239-4fde-9a98-a93d163a5190",
      "proof": "EXACT_MANIFEST"
    },
    {
      "table_name": "promotions",
      "id_hint": "promo-6492bfd8-1c4a-4122-8896-64f0830aa9d4",
      "expected_md5": "4870035df2fa69503030e3029cf386d2",
      "run": "8a89fd93-552a-489d-ae6b-e0afabf899e7",
      "proof": "EXACT_MANIFEST"
    },
    {
      "table_name": "promotions",
      "id_hint": "promo-998948b0-a310-4c02-9491-cfec813f42a1",
      "expected_md5": "ed7d2333a2b7a93b3e2f442c201daf23",
      "run": "69237da3-b20c-4a37-93fb-831fd846d867",
      "proof": "SERVER_ACTOR_RECEIPT_AND_RUN"
    },
    {
      "table_name": "reference_reclassifications",
      "id_hint": "3b047130-42aa-4a45-887d-9d7b90f53a85",
      "expected_md5": "d0198fcd39c2ba637cef881bc69d8a58",
      "run": "2607cae4-404d-48bc-bdfc-6381b9c4a173",
      "proof": "DEPENDENCY_EXACT_HASH_PARENT_CHECK_REQUIRED"
    },
    {
      "table_name": "reference_reclassifications",
      "id_hint": "e37fd019-e694-4827-9a7d-1c1cb96b8438",
      "expected_md5": "cc6468d4b3e9912fd78cf261d5b5137b",
      "run": "8a89fd93-552a-489d-ae6b-e0afabf899e7",
      "proof": "DEPENDENCY_EXACT_HASH_PARENT_CHECK_REQUIRED"
    },
    {
      "table_name": "return_commits",
      "id_hint": "5e92d8f7-1cc5-4bbb-b4d3-404c4d833bab",
      "expected_md5": "4a35e518a962f13c3d5173585f370346",
      "run": "2607cae4-404d-48bc-bdfc-6381b9c4a173",
      "proof": "DEPENDENCY_EXACT_HASH_PARENT_CHECK_REQUIRED"
    },
    {
      "table_name": "return_commits",
      "id_hint": "71e7d2e5-b0b4-4ad4-b808-4d74388cf16d",
      "expected_md5": "e2ca64e2c56ac1d14a157c0d561de844",
      "run": "8a89fd93-552a-489d-ae6b-e0afabf899e7",
      "proof": "DEPENDENCY_EXACT_HASH_PARENT_CHECK_REQUIRED"
    },
    {
      "table_name": "return_items",
      "id_hint": "43",
      "expected_md5": "2e0333e51b5648b121c9942c4a3b65d5",
      "run": "2607cae4-404d-48bc-bdfc-6381b9c4a173",
      "proof": "DEPENDENCY_EXACT_HASH_PARENT_CHECK_REQUIRED"
    },
    {
      "table_name": "return_items",
      "id_hint": "44",
      "expected_md5": "f323802d10cfd8a5a914da5f1670e047",
      "run": "8a89fd93-552a-489d-ae6b-e0afabf899e7",
      "proof": "DEPENDENCY_EXACT_HASH_PARENT_CHECK_REQUIRED"
    },
    {
      "table_name": "returns",
      "id_hint": "ret-5e92d8f7-1cc5-4bbb-b4d3-404c4d833bab",
      "expected_md5": "bafea5dc8b469d8f3805801750c0e766",
      "run": "2607cae4-404d-48bc-bdfc-6381b9c4a173",
      "proof": "EXACT_MANIFEST"
    },
    {
      "table_name": "returns",
      "id_hint": "ret-71e7d2e5-b0b4-4ad4-b808-4d74388cf16d",
      "expected_md5": "6bc4c344ab27923d25ac9c05de6be797",
      "run": "8a89fd93-552a-489d-ae6b-e0afabf899e7",
      "proof": "EXACT_MANIFEST"
    },
    {
      "table_name": "sale_commits",
      "id_hint": "2bb786c0-3251-4048-871d-b0814ad6289a",
      "expected_md5": "0c3effd6c977a2f29ea288b1b6aca1ce",
      "run": "8a89fd93-552a-489d-ae6b-e0afabf899e7",
      "proof": "DEPENDENCY_EXACT_HASH_PARENT_CHECK_REQUIRED"
    },
    {
      "table_name": "sale_commits",
      "id_hint": "2bb786c0-3251-4048-871d-b0814ad6289a",
      "expected_md5": "62bbc02790ca462fb6205a774d6fb3ea",
      "run": "8a89fd93-552a-489d-ae6b-e0afabf899e7",
      "proof": "DEPENDENCY_EXACT_HASH_PARENT_CHECK_REQUIRED"
    },
    {
      "table_name": "sale_commits",
      "id_hint": "2bb786c0-3251-4048-871d-b0814ad6289a",
      "expected_md5": "8adbb793f8d1b5532c8267cfebf08f54",
      "run": "8a89fd93-552a-489d-ae6b-e0afabf899e7",
      "proof": "DEPENDENCY_EXACT_HASH_PARENT_CHECK_REQUIRED"
    },
    {
      "table_name": "sale_commits",
      "id_hint": "3cb959ec-ca9f-4e52-b83e-6d829171634e",
      "expected_md5": "ed7f74a4a7d847cc671f284c121cf607",
      "run": "8a89fd93-552a-489d-ae6b-e0afabf899e7",
      "proof": "DEPENDENCY_EXACT_HASH_PARENT_CHECK_REQUIRED"
    },
    {
      "table_name": "sale_commits",
      "id_hint": "55dc5ef6-9300-4b20-bae8-5ff9d9e9738d",
      "expected_md5": "5c49b2a711dd28b45d9b79ac720874a3",
      "run": "2607cae4-404d-48bc-bdfc-6381b9c4a173",
      "proof": "DEPENDENCY_EXACT_HASH_PARENT_CHECK_REQUIRED"
    },
    {
      "table_name": "sale_commits",
      "id_hint": "b857ae81-cb1c-41ed-b630-3f4efebe3789",
      "expected_md5": "82889ae45bafbcb582391898adf4d86f",
      "run": "8a89fd93-552a-489d-ae6b-e0afabf899e7",
      "proof": "DEPENDENCY_EXACT_HASH_PARENT_CHECK_REQUIRED"
    },
    {
      "table_name": "sale_commits",
      "id_hint": "bc088419-d9c5-45c7-b7de-063b70e230bd",
      "expected_md5": "73680ba5f7be424752d08b29218b63a5",
      "run": "2607cae4-404d-48bc-bdfc-6381b9c4a173",
      "proof": "DEPENDENCY_EXACT_HASH_PARENT_CHECK_REQUIRED"
    },
    {
      "table_name": "sale_commits",
      "id_hint": "c652df23-8a36-45da-9287-91af1647c94b",
      "expected_md5": "7b486b3a078978eb66ce215d23d459a0",
      "run": "8a89fd93-552a-489d-ae6b-e0afabf899e7",
      "proof": "DEPENDENCY_EXACT_HASH_PARENT_CHECK_REQUIRED"
    },
    {
      "table_name": "sale_commits",
      "id_hint": "d50de195-573a-49b3-9e7a-0cf94bf1a4c6",
      "expected_md5": "2c5de239a115271d7c0584402b08c2e4",
      "run": "2607cae4-404d-48bc-bdfc-6381b9c4a173",
      "proof": "DEPENDENCY_EXACT_HASH_PARENT_CHECK_REQUIRED"
    },
    {
      "table_name": "sale_commits",
      "id_hint": "d50de195-573a-49b3-9e7a-0cf94bf1a4c6",
      "expected_md5": "82e25b9823a8919593405eec38827a7a",
      "run": "2607cae4-404d-48bc-bdfc-6381b9c4a173",
      "proof": "DEPENDENCY_EXACT_HASH_PARENT_CHECK_REQUIRED"
    },
    {
      "table_name": "sale_commits",
      "id_hint": "d50de195-573a-49b3-9e7a-0cf94bf1a4c6",
      "expected_md5": "a481dca090271695768ba44aaaf648c3",
      "run": "2607cae4-404d-48bc-bdfc-6381b9c4a173",
      "proof": "DEPENDENCY_EXACT_HASH_PARENT_CHECK_REQUIRED"
    },
    {
      "table_name": "sale_items",
      "id_hint": "290",
      "expected_md5": "55445586b8e8be6f81b5cd0829421369",
      "run": "2607cae4-404d-48bc-bdfc-6381b9c4a173",
      "proof": "DEPENDENCY_EXACT_HASH_PARENT_CHECK_REQUIRED"
    },
    {
      "table_name": "sale_items",
      "id_hint": "291",
      "expected_md5": "e13a1f169a11b9ddb93d0c6a930405f7",
      "run": "2607cae4-404d-48bc-bdfc-6381b9c4a173",
      "proof": "DEPENDENCY_EXACT_HASH_PARENT_CHECK_REQUIRED"
    },
    {
      "table_name": "sale_items",
      "id_hint": "295",
      "expected_md5": "4fae9c6b71f0a29e0cd10b304de6835e",
      "run": "2607cae4-404d-48bc-bdfc-6381b9c4a173",
      "proof": "DEPENDENCY_EXACT_HASH_PARENT_CHECK_REQUIRED"
    },
    {
      "table_name": "sale_items",
      "id_hint": "296",
      "expected_md5": "07228989ad1368f67aedea1b5fdaa27b",
      "run": "8a89fd93-552a-489d-ae6b-e0afabf899e7",
      "proof": "DEPENDENCY_EXACT_HASH_PARENT_CHECK_REQUIRED"
    },
    {
      "table_name": "sale_items",
      "id_hint": "297",
      "expected_md5": "f7f089f3a094b8564be40dc079dd4c53",
      "run": "8a89fd93-552a-489d-ae6b-e0afabf899e7",
      "proof": "DEPENDENCY_EXACT_HASH_PARENT_CHECK_REQUIRED"
    },
    {
      "table_name": "sale_items",
      "id_hint": "298",
      "expected_md5": "d5d0432494ac5ae88022ed2991433e0a",
      "run": "8a89fd93-552a-489d-ae6b-e0afabf899e7",
      "proof": "DEPENDENCY_EXACT_HASH_PARENT_CHECK_REQUIRED"
    },
    {
      "table_name": "sale_items",
      "id_hint": "302",
      "expected_md5": "eab6da55a210e30a326457b62dbd3f6e",
      "run": "8a89fd93-552a-489d-ae6b-e0afabf899e7",
      "proof": "DEPENDENCY_EXACT_HASH_PARENT_CHECK_REQUIRED"
    },
    {
      "table_name": "sale_payments",
      "id_hint": "pay-0136d484-daca-4a3b-8503-ec830171ea2b",
      "expected_md5": "22d171c4d488b97a876b55be9c227f1f",
      "run": "2607cae4-404d-48bc-bdfc-6381b9c4a173",
      "proof": "EXACT_PAYMENT_VALIDATED_SALE_OR_EXCHANGE"
    },
    {
      "table_name": "sale_payments",
      "id_hint": "pay-070f8d45-1adf-4470-b471-8b9924ffaa0e",
      "expected_md5": "4d4a9957ca933709db5ab0f1f022e002",
      "run": "2607cae4-404d-48bc-bdfc-6381b9c4a173",
      "proof": "EXACT_PAYMENT_VALIDATED_SALE_OR_EXCHANGE"
    },
    {
      "table_name": "sale_payments",
      "id_hint": "pay-0eca65c9-c7e1-498e-b656-d0256dc34ec4",
      "expected_md5": "279040af481805cda68e19cf2d254730",
      "run": "8a89fd93-552a-489d-ae6b-e0afabf899e7",
      "proof": "EXACT_PAYMENT_VALIDATED_SALE_OR_EXCHANGE"
    },
    {
      "table_name": "sale_payments",
      "id_hint": "pay-2f16bfba-e336-4c45-8ffd-a886f00b202c",
      "expected_md5": "4564e68b3aa48fbf38bd9d4874164045",
      "run": "2607cae4-404d-48bc-bdfc-6381b9c4a173",
      "proof": "EXACT_PAYMENT_VALIDATED_SALE_OR_EXCHANGE"
    },
    {
      "table_name": "sale_payments",
      "id_hint": "pay-6bb4dddc-276e-4989-9428-386994651968",
      "expected_md5": "8facd4afa43f75ce6a699101970338a5",
      "run": "8a89fd93-552a-489d-ae6b-e0afabf899e7",
      "proof": "EXACT_PAYMENT_VALIDATED_SALE_OR_EXCHANGE"
    },
    {
      "table_name": "sale_payments",
      "id_hint": "pay-81403397-2584-4227-94bb-f0f5d2c473f8",
      "expected_md5": "29c7141d767f525b95933e1bb55bf836",
      "run": "8a89fd93-552a-489d-ae6b-e0afabf899e7",
      "proof": "EXACT_PAYMENT_VALIDATED_SALE_OR_EXCHANGE"
    },
    {
      "table_name": "sale_payments",
      "id_hint": "pay-8c659151-46ac-46ff-8f36-e8c4feee19eb",
      "expected_md5": "732ce2fac825e844ba5de0316f194bbd",
      "run": "8a89fd93-552a-489d-ae6b-e0afabf899e7",
      "proof": "EXACT_PAYMENT_VALIDATED_SALE_OR_EXCHANGE"
    },
    {
      "table_name": "sale_payments",
      "id_hint": "pay-b753b255-d3f2-40fb-b76a-71f08d45b732",
      "expected_md5": "dbeca2960a07eb004bac4dcce8cae9de",
      "run": "2607cae4-404d-48bc-bdfc-6381b9c4a173",
      "proof": "EXACT_PAYMENT_VALIDATED_SALE_OR_EXCHANGE"
    },
    {
      "table_name": "sale_payments",
      "id_hint": "pay-b93e8afd-289c-4aac-9342-ef9d079819c6",
      "expected_md5": "67bfd2332cdd73fb4a57c99b00987e31",
      "run": "8a89fd93-552a-489d-ae6b-e0afabf899e7",
      "proof": "EXACT_PAYMENT_VALIDATED_SALE_OR_EXCHANGE"
    },
    {
      "table_name": "sale_payments",
      "id_hint": "pay-be1ac191-a883-4de8-9756-e58292c62387",
      "expected_md5": "35e992bcd0784c724f9d9d2ce8617a67",
      "run": "8a89fd93-552a-489d-ae6b-e0afabf899e7",
      "proof": "EXACT_PAYMENT_VALIDATED_SALE_OR_EXCHANGE"
    },
    {
      "table_name": "sale_payments",
      "id_hint": "pay-cmb-3ba2082f-8e49-45de-8110-7d0f628dff05",
      "expected_md5": "5821c8ea9129ec8d5e03e3377b3b364b",
      "run": "2607cae4-404d-48bc-bdfc-6381b9c4a173",
      "proof": "EXACT_PAYMENT_VALIDATED_SALE_OR_EXCHANGE"
    },
    {
      "table_name": "sale_payments",
      "id_hint": "pay-cmb-eac348da-0735-4473-82de-fdb32f375abe",
      "expected_md5": "9d957361398dfe383d5f869abada5cec",
      "run": "8a89fd93-552a-489d-ae6b-e0afabf899e7",
      "proof": "EXACT_PAYMENT_VALIDATED_SALE_OR_EXCHANGE"
    },
    {
      "table_name": "sale_payments",
      "id_hint": "pay-f64bd3e3-9ecf-4dcb-9222-9e27372d4650",
      "expected_md5": "bd6c37d9cf2f308b84b4ab6c15f97530",
      "run": "2607cae4-404d-48bc-bdfc-6381b9c4a173",
      "proof": "EXACT_PAYMENT_VALIDATED_SALE_OR_EXCHANGE"
    },
    {
      "table_name": "sales",
      "id_hint": "BG-260912-0002",
      "expected_md5": "1fccdf328773f0bbc5ba1b002d5dfdef",
      "run": "2607cae4-404d-48bc-bdfc-6381b9c4a173",
      "proof": "MANIFEST_ACTOR_OPERATION_CLIENT_ALL_LINES"
    },
    {
      "table_name": "sales",
      "id_hint": "BG-260912-0004",
      "expected_md5": "6ea5a1c0ac82637e758a1b2f48d2bece",
      "run": "2607cae4-404d-48bc-bdfc-6381b9c4a173",
      "proof": "MANIFEST_ACTOR_OPERATION_CLIENT_ALL_LINES"
    },
    {
      "table_name": "sales",
      "id_hint": "BG-260912-0007",
      "expected_md5": "acefe9f3a770c0ccc930d5b17ab8cf94",
      "run": "2607cae4-404d-48bc-bdfc-6381b9c4a173",
      "proof": "MANIFEST_ACTOR_OPERATION_CLIENT_ALL_LINES"
    },
    {
      "table_name": "sales",
      "id_hint": "BG-260912-0008",
      "expected_md5": "9fa286aaacb9ee8dcb451b3b8f61af84",
      "run": "8a89fd93-552a-489d-ae6b-e0afabf899e7",
      "proof": "MANIFEST_ACTOR_OPERATION_CLIENT_ALL_LINES"
    },
    {
      "table_name": "sales",
      "id_hint": "BG-260912-0009",
      "expected_md5": "accbf2f674834c22bb3f55a11f40b038",
      "run": "8a89fd93-552a-489d-ae6b-e0afabf899e7",
      "proof": "MANIFEST_ACTOR_OPERATION_CLIENT_ALL_LINES"
    },
    {
      "table_name": "sales",
      "id_hint": "BG-260912-0010",
      "expected_md5": "846427d98359b00a289641f297aaeaeb",
      "run": "8a89fd93-552a-489d-ae6b-e0afabf899e7",
      "proof": "MANIFEST_ACTOR_OPERATION_CLIENT_ALL_LINES"
    },
    {
      "table_name": "sales",
      "id_hint": "BG-260912-0014",
      "expected_md5": "fd3451cf48a56c4e7be353866454dd31",
      "run": "8a89fd93-552a-489d-ae6b-e0afabf899e7",
      "proof": "MANIFEST_ACTOR_OPERATION_CLIENT_ALL_LINES"
    },
    {
      "table_name": "sellers",
      "id_hint": "0c854997-d4cb-4f5a-bf19-6640498c8219",
      "expected_md5": "51ed505dabfa1deb4b7e14f66ad7e888",
      "run": "2607cae4-404d-48bc-bdfc-6381b9c4a173",
      "proof": "EXACT_MANIFEST"
    },
    {
      "table_name": "sellers",
      "id_hint": "6dd83591-9e6b-482f-95e0-78470766cbce",
      "expected_md5": "d99b1882da596e1d8fb9f63aaab96ef4",
      "run": "69237da3-b20c-4a37-93fb-831fd846d867",
      "proof": "SERVER_ACTOR_RECEIPT_AND_RUN"
    },
    {
      "table_name": "sellers",
      "id_hint": "720db98c-e653-4d86-8d5e-eab00a315959",
      "expected_md5": "9e9e56dce90b4df48b5f8953566d2e09",
      "run": "ca80e903-4239-4fde-9a98-a93d163a5190",
      "proof": "EXACT_MANIFEST"
    },
    {
      "table_name": "sellers",
      "id_hint": "7e869e19-be08-40fb-96e0-7e444795e8fa",
      "expected_md5": "05e25b7258c4d078ab90d78972f67665",
      "run": "6d340d65-7e61-486e-9a2f-f189a57bf7ec",
      "proof": "SERVER_ACTOR_RECEIPT_AND_RUN"
    },
    {
      "table_name": "sellers",
      "id_hint": "85fd870d-1d81-484b-84d3-de60cd2576ec",
      "expected_md5": "0b321a249b53c0d2d7bf66d89fc4b12b",
      "run": "8a89fd93-552a-489d-ae6b-e0afabf899e7",
      "proof": "EXACT_MANIFEST"
    },
    {
      "table_name": "sellers",
      "id_hint": "qa-h148-b766e373-5279-4e4a-818e-0934a4f8757c-admin",
      "expected_md5": "f3e6b4ffadf83b5592c8e3ed2bf5a49d",
      "run": "b766e373-5279-4e4a-818e-0934a4f8757c",
      "proof": "H148_EXACT_RUNNER_CERTIFIED_SHA_AND_DETERMINISTIC_ID"
    },
    {
      "table_name": "sellers",
      "id_hint": "qa-h148-b766e373-5279-4e4a-818e-0934a4f8757c-seller",
      "expected_md5": "d87dd99e19882795dae3c7f672bd9fab",
      "run": "b766e373-5279-4e4a-818e-0934a4f8757c",
      "proof": "H148_EXACT_RUNNER_CERTIFIED_SHA_AND_DETERMINISTIC_ID"
    },
    {
      "table_name": "sellers",
      "id_hint": "qa-h164-2607cae4-404d-48bc-bdfc-6381b9c4a173-admin",
      "expected_md5": "2ed03a12be99b2e812b126797426e3a6",
      "run": "2607cae4-404d-48bc-bdfc-6381b9c4a173",
      "proof": "EXACT_MANIFEST"
    },
    {
      "table_name": "sellers",
      "id_hint": "qa-h164-2607cae4-404d-48bc-bdfc-6381b9c4a173-seller-A",
      "expected_md5": "94a969ddd0e0013790f08362c9212d45",
      "run": "2607cae4-404d-48bc-bdfc-6381b9c4a173",
      "proof": "EXACT_MANIFEST"
    },
    {
      "table_name": "sellers",
      "id_hint": "qa-h164-2607cae4-404d-48bc-bdfc-6381b9c4a173-seller-B",
      "expected_md5": "e251d6cf7aa541e0c2bce4f8b5bc21ad",
      "run": "2607cae4-404d-48bc-bdfc-6381b9c4a173",
      "proof": "EXACT_MANIFEST"
    },
    {
      "table_name": "sellers",
      "id_hint": "qa-h164-2607cae4-404d-48bc-bdfc-6381b9c4a173-seller-C",
      "expected_md5": "ea4b3c2d7988ea7d2ab5af76280ba9fa",
      "run": "2607cae4-404d-48bc-bdfc-6381b9c4a173",
      "proof": "EXACT_MANIFEST"
    },
    {
      "table_name": "sellers",
      "id_hint": "qa-h164-69237da3-b20c-4a37-93fb-831fd846d867-admin",
      "expected_md5": "0120b300e3417015cba4bcd4c33d7bb4",
      "run": "69237da3-b20c-4a37-93fb-831fd846d867",
      "proof": "RUNNER_DETERMINISTIC_ID_JOINT_PROVENANCE"
    },
    {
      "table_name": "sellers",
      "id_hint": "qa-h164-69237da3-b20c-4a37-93fb-831fd846d867-seller-A",
      "expected_md5": "1728a172d86a46bb7d975fa2d2622715",
      "run": "69237da3-b20c-4a37-93fb-831fd846d867",
      "proof": "SERVER_ACTOR_RECEIPT_AND_RUN"
    },
    {
      "table_name": "sellers",
      "id_hint": "qa-h164-69237da3-b20c-4a37-93fb-831fd846d867-seller-B",
      "expected_md5": "582a41e00a6a1e93ed9b5a6e1ce2af75",
      "run": "69237da3-b20c-4a37-93fb-831fd846d867",
      "proof": "SERVER_ACTOR_RECEIPT_AND_RUN"
    },
    {
      "table_name": "sellers",
      "id_hint": "qa-h164-69237da3-b20c-4a37-93fb-831fd846d867-seller-C",
      "expected_md5": "8fae79cf35cb16348168005ff92d44f4",
      "run": "69237da3-b20c-4a37-93fb-831fd846d867",
      "proof": "RUNNER_DETERMINISTIC_ID_JOINT_PROVENANCE"
    },
    {
      "table_name": "sellers",
      "id_hint": "qa-h164-6d340d65-7e61-486e-9a2f-f189a57bf7ec-admin",
      "expected_md5": "88aedcf906817665e6a34b79df959177",
      "run": "6d340d65-7e61-486e-9a2f-f189a57bf7ec",
      "proof": "RUNNER_DETERMINISTIC_ID_JOINT_PROVENANCE"
    },
    {
      "table_name": "sellers",
      "id_hint": "qa-h164-6d340d65-7e61-486e-9a2f-f189a57bf7ec-seller-A",
      "expected_md5": "46f8a64aba4dc8c4fc961ed353c24620",
      "run": "6d340d65-7e61-486e-9a2f-f189a57bf7ec",
      "proof": "SERVER_ACTOR_RECEIPT_AND_RUN"
    },
    {
      "table_name": "sellers",
      "id_hint": "qa-h164-6d340d65-7e61-486e-9a2f-f189a57bf7ec-seller-B",
      "expected_md5": "26bd23226ae3aca02890d64847173839",
      "run": "6d340d65-7e61-486e-9a2f-f189a57bf7ec",
      "proof": "SERVER_ACTOR_RECEIPT_AND_RUN"
    },
    {
      "table_name": "sellers",
      "id_hint": "qa-h164-6d340d65-7e61-486e-9a2f-f189a57bf7ec-seller-C",
      "expected_md5": "6a1b6cfd838e2f8e9e2664f343efec18",
      "run": "6d340d65-7e61-486e-9a2f-f189a57bf7ec",
      "proof": "RUNNER_DETERMINISTIC_ID_JOINT_PROVENANCE"
    },
    {
      "table_name": "sellers",
      "id_hint": "qa-h164-8a89fd93-552a-489d-ae6b-e0afabf899e7-admin",
      "expected_md5": "f3482e1541e0383477c0a5d0a7932e8e",
      "run": "8a89fd93-552a-489d-ae6b-e0afabf899e7",
      "proof": "EXACT_MANIFEST"
    },
    {
      "table_name": "sellers",
      "id_hint": "qa-h164-8a89fd93-552a-489d-ae6b-e0afabf899e7-seller-A",
      "expected_md5": "c1f25bf79e9ffe9c91e508155018d7e0",
      "run": "8a89fd93-552a-489d-ae6b-e0afabf899e7",
      "proof": "EXACT_MANIFEST"
    },
    {
      "table_name": "sellers",
      "id_hint": "qa-h164-8a89fd93-552a-489d-ae6b-e0afabf899e7-seller-B",
      "expected_md5": "9a00e871b79ec6f34f40fd9d56e24a7d",
      "run": "8a89fd93-552a-489d-ae6b-e0afabf899e7",
      "proof": "EXACT_MANIFEST"
    },
    {
      "table_name": "sellers",
      "id_hint": "qa-h164-8a89fd93-552a-489d-ae6b-e0afabf899e7-seller-C",
      "expected_md5": "2c7e99cc60dba2d26c105883c014491b",
      "run": "8a89fd93-552a-489d-ae6b-e0afabf899e7",
      "proof": "EXACT_MANIFEST"
    },
    {
      "table_name": "sellers",
      "id_hint": "qa-h164-ca80e903-4239-4fde-9a98-a93d163a5190-admin",
      "expected_md5": "bb51c2a93371e3f4581fd854e8325d90",
      "run": "ca80e903-4239-4fde-9a98-a93d163a5190",
      "proof": "EXACT_MANIFEST"
    },
    {
      "table_name": "sellers",
      "id_hint": "qa-h164-ca80e903-4239-4fde-9a98-a93d163a5190-seller-A",
      "expected_md5": "15eaac88725f279e8756c832a2263cbb",
      "run": "ca80e903-4239-4fde-9a98-a93d163a5190",
      "proof": "EXACT_MANIFEST"
    },
    {
      "table_name": "sellers",
      "id_hint": "qa-h164-ca80e903-4239-4fde-9a98-a93d163a5190-seller-B",
      "expected_md5": "6e427cd37ed51af8e57aaa4e2c3972a6",
      "run": "ca80e903-4239-4fde-9a98-a93d163a5190",
      "proof": "EXACT_MANIFEST"
    },
    {
      "table_name": "sellers",
      "id_hint": "qa-h164-ca80e903-4239-4fde-9a98-a93d163a5190-seller-C",
      "expected_md5": "fd686a36dc0f10cbd7879be73d4c04d8",
      "run": "ca80e903-4239-4fde-9a98-a93d163a5190",
      "proof": "EXACT_MANIFEST"
    },
    {
      "table_name": "settings",
      "id_hint": "qa-h148-b766e373-5279-4e4a-818e-0934a4f8757c",
      "expected_md5": "7e25dca923994c69d4198d24c34a6ac2",
      "run": "b766e373-5279-4e4a-818e-0934a4f8757c",
      "proof": "H148_EXACT_RUNNER_CERTIFIED_SHA_AND_DETERMINISTIC_ID"
    },
    {
      "table_name": "settings",
      "id_hint": "qa.h164.2607cae4-404d-48bc-bdfc-6381b9c4a173",
      "expected_md5": "2dd9eeb8b0294a86b73b12ab1c07644a",
      "run": "2607cae4-404d-48bc-bdfc-6381b9c4a173",
      "proof": "EXACT_MANIFEST"
    },
    {
      "table_name": "settings",
      "id_hint": "qa.h164.69237da3-b20c-4a37-93fb-831fd846d867",
      "expected_md5": "b9e564d50700946c8f7bbc20b2850398",
      "run": "69237da3-b20c-4a37-93fb-831fd846d867",
      "proof": "RUNNER_DETERMINISTIC_ID_JOINT_PROVENANCE"
    },
    {
      "table_name": "settings",
      "id_hint": "qa.h164.6d340d65-7e61-486e-9a2f-f189a57bf7ec",
      "expected_md5": "741c1744f94a8aee8be0bb88e5370b67",
      "run": "6d340d65-7e61-486e-9a2f-f189a57bf7ec",
      "proof": "RUNNER_DETERMINISTIC_ID_JOINT_PROVENANCE"
    },
    {
      "table_name": "settings",
      "id_hint": "qa.h164.8a89fd93-552a-489d-ae6b-e0afabf899e7",
      "expected_md5": "0d91213147b58d2172b332cef82a5139",
      "run": "8a89fd93-552a-489d-ae6b-e0afabf899e7",
      "proof": "EXACT_MANIFEST"
    },
    {
      "table_name": "settings",
      "id_hint": "qa.h164.ca80e903-4239-4fde-9a98-a93d163a5190",
      "expected_md5": "0c60abe32e2056730f0eba445115428c",
      "run": "ca80e903-4239-4fde-9a98-a93d163a5190",
      "proof": "EXACT_MANIFEST"
    },
    {
      "table_name": "stock_reservations",
      "id_hint": "2bb786c0-3251-4048-871d-b0814ad6289a",
      "expected_md5": "d8cf37748b0beb50a43fc7c94dd7e4bd",
      "run": "8a89fd93-552a-489d-ae6b-e0afabf899e7",
      "proof": "DEPENDENCY_EXACT_HASH_PARENT_CHECK_REQUIRED"
    },
    {
      "table_name": "stock_reservations",
      "id_hint": "3cb959ec-ca9f-4e52-b83e-6d829171634e",
      "expected_md5": "18b90b61971d6eda81bfae035db809b7",
      "run": "8a89fd93-552a-489d-ae6b-e0afabf899e7",
      "proof": "DEPENDENCY_EXACT_HASH_PARENT_CHECK_REQUIRED"
    },
    {
      "table_name": "stock_reservations",
      "id_hint": "55dc5ef6-9300-4b20-bae8-5ff9d9e9738d",
      "expected_md5": "64ef84c3ec264095dfcebea6f3a4f0e8",
      "run": "2607cae4-404d-48bc-bdfc-6381b9c4a173",
      "proof": "DEPENDENCY_EXACT_HASH_PARENT_CHECK_REQUIRED"
    },
    {
      "table_name": "stock_reservations",
      "id_hint": "b857ae81-cb1c-41ed-b630-3f4efebe3789",
      "expected_md5": "cf446d3bf2a7e04fb62b7feb4f9dbf97",
      "run": "8a89fd93-552a-489d-ae6b-e0afabf899e7",
      "proof": "DEPENDENCY_EXACT_HASH_PARENT_CHECK_REQUIRED"
    },
    {
      "table_name": "stock_reservations",
      "id_hint": "bc088419-d9c5-45c7-b7de-063b70e230bd",
      "expected_md5": "8d3851a5c02ca6349d3f890a46b9eaab",
      "run": "2607cae4-404d-48bc-bdfc-6381b9c4a173",
      "proof": "DEPENDENCY_EXACT_HASH_PARENT_CHECK_REQUIRED"
    },
    {
      "table_name": "stock_reservations",
      "id_hint": "c652df23-8a36-45da-9287-91af1647c94b",
      "expected_md5": "de301a53548c94021199168ecc8f5030",
      "run": "8a89fd93-552a-489d-ae6b-e0afabf899e7",
      "proof": "DEPENDENCY_EXACT_HASH_PARENT_CHECK_REQUIRED"
    },
    {
      "table_name": "stock_reservations",
      "id_hint": "d50de195-573a-49b3-9e7a-0cf94bf1a4c6",
      "expected_md5": "9783224d76258c5b2d7d519e90cd0926",
      "run": "2607cae4-404d-48bc-bdfc-6381b9c4a173",
      "proof": "DEPENDENCY_EXACT_HASH_PARENT_CHECK_REQUIRED"
    },
    {
      "table_name": "user_permission_role_assignments",
      "id_hint": "272aed8a-fab0-48e0-b2ba-e65d3f0884b9",
      "expected_md5": "e3bee77148b3c60c680f08bca07af882",
      "run": "8a89fd93-552a-489d-ae6b-e0afabf899e7",
      "proof": "DEPENDENCY_EXACT_HASH_PARENT_CHECK_REQUIRED"
    },
    {
      "table_name": "user_permission_role_assignments",
      "id_hint": "895b586d-15b7-40ae-8ce1-926492c2a229",
      "expected_md5": "7219570dcec501d2443e4084136f0757",
      "run": "ca80e903-4239-4fde-9a98-a93d163a5190",
      "proof": "DEPENDENCY_EXACT_HASH_PARENT_CHECK_REQUIRED"
    },
    {
      "table_name": "user_permission_role_assignments",
      "id_hint": "eb46cc84-1fe2-4da0-84b6-8332a7ff3bad",
      "expected_md5": "dbf90e16b3f2b6f2cf29607d4e6176cc",
      "run": "2607cae4-404d-48bc-bdfc-6381b9c4a173",
      "proof": "DEPENDENCY_EXACT_HASH_PARENT_CHECK_REQUIRED"
    },
    {
      "table_name": "user_screen_permission_overrides",
      "id_hint": "6dd83591-9e6b-482f-95e0-78470766cbce:reportes",
      "expected_md5": "427d69872809c73b95dc5c03facfc73e",
      "run": "69237da3-b20c-4a37-93fb-831fd846d867",
      "proof": "EXACT_COMPOSITE_PK_ACCOUNT_DEPENDENCY"
    },
    {
      "table_name": "user_screen_permission_overrides",
      "id_hint": "7e869e19-be08-40fb-96e0-7e444795e8fa:reportes",
      "expected_md5": "2e7d9489c6c1e2b0be9056dcfc96cad1",
      "run": "6d340d65-7e61-486e-9a2f-f189a57bf7ec",
      "proof": "EXACT_COMPOSITE_PK_ACCOUNT_DEPENDENCY"
    },
    {
      "table_name": "user_screen_permission_overrides",
      "id_hint": "reportes",
      "expected_md5": "5fb4fc3937fc737d5240aacd1a1a0b54",
      "run": "2607cae4-404d-48bc-bdfc-6381b9c4a173",
      "proof": "DEPENDENCY_EXACT_HASH_PARENT_CHECK_REQUIRED"
    },
    {
      "table_name": "user_screen_permission_overrides",
      "id_hint": "reportes",
      "expected_md5": "937fdd74c1f28c5c1360612995bebb85",
      "run": "8a89fd93-552a-489d-ae6b-e0afabf899e7",
      "proof": "DEPENDENCY_EXACT_HASH_PARENT_CHECK_REQUIRED"
    },
    {
      "table_name": "user_screen_permission_overrides",
      "id_hint": "reportes",
      "expected_md5": "f4ba3f0e6f897a81d5c6b6cd381294e7",
      "run": "ca80e903-4239-4fde-9a98-a93d163a5190",
      "proof": "DEPENDENCY_EXACT_HASH_PARENT_CHECK_REQUIRED"
    }
  ],
  "preserve": {
    "products": 973,
    "families": 251,
    "pieces": 3483,
    "products_md5": "f9e21666ec904d536d7e7273b581cf09",
    "sale_0001_md5": "4d4eccadf33a73be1303d957036886d6"
  },
  "additional_sources": [
    {
      "path": "C:/tmp/balam-h154-live-mXd8pe/matrix.json",
      "sha256": "b4c86b1bc8a63464f44d3d45a203bc46d8f9b937b541fd3220c58a99faa3ee38",
      "runner_sha256": "ade64ab0199a456770f4f2053bd768fc223a99799c3c83210a727645fc71bbf3",
      "scope": "H148 two seller IDs and one setting key only"
    }
  ]
}
$h171_manifest$::jsonb AS j),
expected AS (
 SELECT x->>'table_name' AS table_name,x->>'id_hint' AS id_hint,
 x->>'expected_md5' AS expected_md5,x->>'run' AS run,x->>'proof' AS proof
 FROM manifest,jsonb_array_elements(j->'rows') x
),
all_rows AS MATERIALIZED (
 SELECT 'clients'::text AS table_name,to_jsonb(t) AS j FROM pos.clients t
 UNION ALL
 SELECT 'commission_adjustments'::text AS table_name,to_jsonb(t) AS j FROM pos.commission_adjustments t
 UNION ALL
 SELECT 'config_commits'::text AS table_name,to_jsonb(t) AS j FROM pos.config_commits t
 UNION ALL
 SELECT 'config_sync_state'::text AS table_name,to_jsonb(t) AS j FROM pos.config_sync_state t
 UNION ALL
 SELECT 'exchange_commits'::text AS table_name,to_jsonb(t) AS j FROM pos.exchange_commits t
 UNION ALL
 SELECT 'exchange_items'::text AS table_name,to_jsonb(t) AS j FROM pos.exchange_items t
 UNION ALL
 SELECT 'exchanges'::text AS table_name,to_jsonb(t) AS j FROM pos.exchanges t
 UNION ALL
 SELECT 'folio_counters'::text AS table_name,to_jsonb(t) AS j FROM pos.folio_counters t
 UNION ALL
 SELECT 'layaway_liquidation_commits'::text AS table_name,to_jsonb(t) AS j FROM pos.layaway_liquidation_commits t
 UNION ALL
 SELECT 'liquidations'::text AS table_name,to_jsonb(t) AS j FROM pos.liquidations t
 UNION ALL
 SELECT 'loan_documents'::text AS table_name,to_jsonb(t) AS j FROM pos.loan_documents t
 UNION ALL
 SELECT 'lookup'::text AS table_name,to_jsonb(t) AS j FROM pos.lookup t
 UNION ALL
 SELECT 'movements'::text AS table_name,to_jsonb(t) AS j FROM pos.movements t
 UNION ALL
 SELECT 'permission_roles'::text AS table_name,to_jsonb(t) AS j FROM pos.permission_roles t
 UNION ALL
 SELECT 'physical_card_redemptions'::text AS table_name,to_jsonb(t) AS j FROM pos.physical_card_redemptions t
 UNION ALL
 SELECT 'products'::text AS table_name,to_jsonb(t) AS j FROM pos.products t
 UNION ALL
 SELECT 'promotions'::text AS table_name,to_jsonb(t) AS j FROM pos.promotions t
 UNION ALL
 SELECT 'reference_reclassifications'::text AS table_name,to_jsonb(t) AS j FROM pos.reference_reclassifications t
 UNION ALL
 SELECT 'return_commits'::text AS table_name,to_jsonb(t) AS j FROM pos.return_commits t
 UNION ALL
 SELECT 'return_items'::text AS table_name,to_jsonb(t) AS j FROM pos.return_items t
 UNION ALL
 SELECT 'returns'::text AS table_name,to_jsonb(t) AS j FROM pos.returns t
 UNION ALL
 SELECT 'role_capability_permissions'::text AS table_name,to_jsonb(t) AS j FROM pos.role_capability_permissions t
 UNION ALL
 SELECT 'role_screen_permissions'::text AS table_name,to_jsonb(t) AS j FROM pos.role_screen_permissions t
 UNION ALL
 SELECT 'sale_commits'::text AS table_name,to_jsonb(t) AS j FROM pos.sale_commits t
 UNION ALL
 SELECT 'sale_items'::text AS table_name,to_jsonb(t) AS j FROM pos.sale_items t
 UNION ALL
 SELECT 'sale_payments'::text AS table_name,to_jsonb(t) AS j FROM pos.sale_payments t
 UNION ALL
 SELECT 'sales'::text AS table_name,to_jsonb(t) AS j FROM pos.sales t
 UNION ALL
 SELECT 'screen_permission_catalog'::text AS table_name,to_jsonb(t) AS j FROM pos.screen_permission_catalog t
 UNION ALL
 SELECT 'screen_permission_catalog_state'::text AS table_name,to_jsonb(t) AS j FROM pos.screen_permission_catalog_state t
 UNION ALL
 SELECT 'sellers'::text AS table_name,to_jsonb(t) AS j FROM pos.sellers t
 UNION ALL
 SELECT 'settings'::text AS table_name,to_jsonb(t) AS j FROM pos.settings t
 UNION ALL
 SELECT 'stock_reservations'::text AS table_name,to_jsonb(t) AS j FROM pos.stock_reservations t
 UNION ALL
 SELECT 'user_capability_overrides'::text AS table_name,to_jsonb(t) AS j FROM pos.user_capability_overrides t
 UNION ALL
 SELECT 'user_permission_role_assignments'::text AS table_name,to_jsonb(t) AS j FROM pos.user_permission_role_assignments t
 UNION ALL
 SELECT 'user_screen_permission_overrides'::text AS table_name,to_jsonb(t) AS j FROM pos.user_screen_permission_overrides t
),
primary_columns AS (
 SELECT c.relname AS table_name,a.attname AS column_name,k.ordinality
 FROM pg_index i JOIN pg_class c ON c.oid=i.indrelid JOIN pg_namespace n ON n.oid=c.relnamespace
 CROSS JOIN LATERAL unnest(i.indkey) WITH ORDINALITY k(attnum,ordinality)
 JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum=k.attnum
 WHERE n.nspname='pos' AND i.indisprimary
),
keyed AS MATERIALIZED (
 SELECT a.table_name,a.j,md5(a.j::text) AS row_md5,
 (SELECT jsonb_object_agg(p.column_name,a.j->p.column_name ORDER BY p.ordinality)
 FROM primary_columns p WHERE p.table_name=a.table_name) AS pk
 FROM all_rows a
),
scope AS MATERIALIZED (
 SELECT k.table_name,k.pk,k.j,k.row_md5,e.run,e.proof,e.id_hint
 FROM keyed k JOIN expected e ON e.table_name=k.table_name AND e.expected_md5=k.row_md5
),
scope_checks AS (
 SELECT e.table_name,e.id_hint,e.expected_md5,e.run,e.proof,
 (SELECT count(*) FROM scope s WHERE s.table_name=e.table_name AND s.row_md5=e.expected_md5) AS exact_matches,
 (SELECT count(*) FROM scope s WHERE s.table_name=e.table_name AND s.row_md5=e.expected_md5 AND s.pk IS NOT NULL) AS keyed_matches
 FROM expected e
),
roots AS (
 SELECT table_name,id_hint AS id,run FROM expected
 WHERE table_name IN('products','clients','sellers','sales','returns','exchanges','loan_documents','promotions')
),
outside_refs AS (
 SELECT k.table_name,k.pk,k.row_md5,r.table_name AS referenced_table,r.id AS referenced_id,
 CASE WHEN k.table_name='config_commits' THEN 'PRESERVE_IMMUTABLE_CONFIGURATION_RECEIPT'
 ELSE 'BLOCK_UNSELECTED_COMMERCIAL_REFERENCE' END AS classification
 FROM keyed k JOIN roots r ON position(to_jsonb(r.id)::text IN k.j::text)>0
 OR (k.table_name='movements' AND r.table_name='sales' AND position(r.id IN coalesce(k.j->>'ref',''))>0)
 WHERE NOT EXISTS(SELECT 1 FROM scope s WHERE s.table_name=k.table_name AND s.pk=k.pk)
),
sales_expected AS (
 SELECT x->>'run' AS run,x->>'folio' AS folio,x->>'operation_id' AS operation_id,
 x->>'client_id' AS client_id,(x->>'actor_id')::uuid AS actor_id
 FROM manifest,jsonb_array_elements(j->'sales') x
),
sale_checks AS (
 SELECT x.folio,
 s.operation_id=x.operation_id AS operation_matches,
 s.cliente_id=x.client_id AS client_matches,
 EXISTS(SELECT 1 FROM pos.online_requests r WHERE r.actor_id=x.actor_id AND r.state='confirmed'
 AND (r.request_id::text=x.operation_id OR jsonb_path_exists(r.response,'$.**.operation_id ? (@ == $id)',jsonb_build_object('id',x.operation_id)))) AS actor_receipt_matches,
 (SELECT count(*) FROM pos.sale_items i WHERE i.folio=x.folio) AS line_count,
 NOT EXISTS(SELECT 1 FROM pos.sale_items i WHERE i.folio=x.folio AND NOT EXISTS(
 SELECT 1 FROM scope p WHERE p.table_name='products' AND p.j->>'id'=i.product_id AND p.run=x.run)) AS all_products_same_qa_run
 FROM sales_expected x LEFT JOIN pos.sales s ON s.folio=x.folio
),
linked_rows AS (
 SELECT s.table_name,s.pk,s.row_md5,
 CASE
 WHEN s.table_name='sale_commits' THEN EXISTS(SELECT 1 FROM sales_expected p WHERE p.folio=s.j->>'folio' AND p.operation_id=s.j->>'operation_id')
 WHEN s.table_name='stock_reservations' THEN EXISTS(SELECT 1 FROM sales_expected p WHERE p.folio=s.j->>'folio' AND p.operation_id=s.j->>'operation_id')
 WHEN s.table_name='sale_items' THEN EXISTS(SELECT 1 FROM sales_expected p WHERE p.folio=s.j->>'folio')
 WHEN s.table_name='sale_payments' THEN EXISTS(SELECT 1 FROM sales_expected p WHERE p.folio=s.j->>'folio')
 OR EXISTS(SELECT 1 FROM scope p WHERE p.table_name='exchanges' AND p.j->>'folio'=s.j->>'folio' AND 'pay-'||(p.j->>'id')=s.j->>'id')
 WHEN s.table_name='returns' THEN EXISTS(SELECT 1 FROM sales_expected p WHERE p.folio=s.j->>'folio')
 WHEN s.table_name='exchanges' THEN EXISTS(SELECT 1 FROM sales_expected p WHERE p.folio=s.j->>'origen_folio')
 WHEN s.table_name='return_items' THEN EXISTS(SELECT 1 FROM scope p WHERE p.table_name='returns' AND p.j->>'id'=s.j->>'return_id')
 WHEN s.table_name='exchange_items' THEN EXISTS(SELECT 1 FROM scope p WHERE p.table_name='exchanges' AND p.j->>'id'=s.j->>'exchange_id')
 WHEN s.table_name='return_commits' THEN EXISTS(SELECT 1 FROM scope p WHERE p.table_name='returns' AND p.j->>'id'=s.j->>'return_id')
 WHEN s.table_name='exchange_commits' THEN EXISTS(SELECT 1 FROM scope p WHERE p.table_name='exchanges' AND p.j->>'id'=s.j->>'exchange_id')
 WHEN s.table_name='layaway_liquidation_commits' THEN EXISTS(SELECT 1 FROM sales_expected p WHERE p.folio=s.j->>'folio' AND p.operation_id=s.j->>'operation_id')
 WHEN s.table_name='liquidations' THEN EXISTS(SELECT 1 FROM scope p WHERE p.table_name='sellers' AND p.j->>'id'=s.j->>'seller_id')
 WHEN s.table_name='reference_reclassifications' THEN
 EXISTS(SELECT 1 FROM scope p WHERE p.table_name='products' AND p.run=s.run AND p.j->>'id'=s.j->>'source_product_id')
 AND EXISTS(SELECT 1 FROM scope p WHERE p.table_name='products' AND p.run=s.run AND p.j->>'id'=s.j->>'target_product_id')
 WHEN s.table_name='movements' THEN EXISTS(SELECT 1 FROM scope p WHERE p.table_name='products' AND p.run=s.run AND p.j->>'id'=s.j->>'product_id')
 AND (
  ((s.j->>'operation_id') IS NOT NULL AND EXISTS(SELECT 1 FROM scope p WHERE p.table_name='reference_reclassifications' AND p.j->>'operation_id'=s.j->>'operation_id' AND p.run=s.run))
  OR EXISTS(SELECT 1 FROM sales_expected p WHERE p.run=s.run AND p.folio=substring(s.j->>'ref' FROM '(BG-[0-9]{6}-[0-9]+)'))
  OR EXISTS(SELECT 1 FROM scope p WHERE p.table_name='exchanges' AND p.run=s.run AND p.j->>'folio'=substring(s.j->>'ref' FROM '(BG-[0-9]{6}-[0-9]+)'))
 )
 ELSE true END AS parent_scope_matches
 FROM scope s
),
foreign_product_links AS (
 SELECT 'barcode_aliases'::text AS table_name,to_jsonb(b)->>'product_id' AS product_id,md5(to_jsonb(b)::text) AS row_md5
 FROM pos.barcode_aliases b JOIN roots r ON r.table_name='products' AND r.id=b.product_id
 UNION ALL SELECT 'inventory_v1_v2_map',m.target_v2_product_id,md5(to_jsonb(m)::text)
 FROM pos.inventory_v1_v2_map m JOIN roots r ON r.table_name='products' AND r.id=m.target_v2_product_id
),
unselected_hashes AS (
 SELECT k.table_name,count(*) AS row_count,
 md5(coalesce(string_agg(k.row_md5,'' ORDER BY k.j::text),'')) AS rows_md5_sorted_json
 FROM keyed k WHERE NOT EXISTS(SELECT 1 FROM scope s WHERE s.table_name=k.table_name AND s.pk=k.pk)
 GROUP BY k.table_name
),
remaining_inventory AS (
 SELECT count(*) AS rows,count(*) FILTER(WHERE p.deleted_at IS NULL) AS active,
 count(DISTINCT p.reference_family_id) FILTER(WHERE p.deleted_at IS NULL) AS families,
 sum(p.stock_quantity) FILTER(WHERE p.deleted_at IS NULL AND p.record_model='v2') AS pieces,
 md5(coalesce(string_agg(md5(to_jsonb(p)::text),'' ORDER BY p.id),'')) AS rows_md5
 FROM pos.products p WHERE NOT EXISTS(SELECT 1 FROM roots r WHERE r.table_name='products' AND r.id=p.id)
)
SELECT jsonb_build_object(
 'audit','H171 exact QA cleanup SELECT dry-run','generated_at',clock_timestamp(),
 'read_only',current_setting('transaction_read_only'),'expected_project_ref','telohdbvbvsfmwyriflz',
 'manifest_md5',(SELECT md5(j::text) FROM manifest),
 'expected_rows',(SELECT count(*) FROM expected),'matched_rows',(SELECT count(*) FROM scope),
 'scope',(SELECT coalesce(jsonb_agg(jsonb_build_object('table',s.table_name,'pk',s.pk,'row_md5',s.row_md5,'run',s.run,'proof',s.proof) ORDER BY s.table_name,s.pk::text),'[]'::jsonb) FROM scope s),
 'scope_by_table',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY table_name),'[]'::jsonb) FROM (SELECT table_name,count(*) AS rows FROM scope GROUP BY table_name) t),
 'scope_hash_failures',(SELECT coalesce(jsonb_agg(to_jsonb(t)),'[]'::jsonb) FROM scope_checks t WHERE exact_matches<>1 OR keyed_matches<>1),
 'sale_checks',(SELECT jsonb_agg(to_jsonb(s) ORDER BY folio) FROM sale_checks s),
 'parent_failures',(SELECT coalesce(jsonb_agg(to_jsonb(l)),'[]'::jsonb) FROM linked_rows l WHERE NOT coalesce(parent_scope_matches,false)),
 'outside_references',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY table_name,pk::text),'[]'::jsonb) FROM outside_refs t),
 'product_fk_blockers',(SELECT coalesce(jsonb_agg(to_jsonb(t)),'[]'::jsonb) FROM foreign_product_links t),
 'unselected_commercial_hashes',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY table_name),'[]'::jsonb) FROM unselected_hashes t),
 'remaining_inventory',(SELECT to_jsonb(r) FROM remaining_inventory r),
 'inventory_guard',(SELECT r.rows=973 AND r.active=973 AND r.families=251 AND r.pieces=3483
 AND r.rows_md5=(j->'preserve'->>'products_md5') FROM remaining_inventory r,manifest),
 'protected_sale_guard',(SELECT md5(to_jsonb(s)::text)=(j->'preserve'->>'sale_0001_md5')
 FROM pos.sales s CROSS JOIN manifest WHERE s.folio='BG-260912-0001'),
 'preserved_folio_counters',(SELECT jsonb_agg(jsonb_build_object('row_md5',md5(to_jsonb(f)::text)) ORDER BY to_jsonb(f)::text) FROM pos.folio_counters f),
 'excluded',jsonb_build_array('auth.*','storage.*','online_requests','online_account_requests','online_legacy_*','sync_devices','config_commits','folio_counters','unknown H148 candidates'),
 'execution_authorized',false
) AS report;
COMMIT;
