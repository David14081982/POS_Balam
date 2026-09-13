-- H-171 BALAM authority inventory. READ ONLY. No fixture creation or cleanup.
-- Expected CLI link: telohdbvbvsfmwyriflz. Verify it before execution.
-- Output contains counts, hashes and technical identities; no passwords, tokens,
-- personal names, addresses, emails, business payloads or archive originals.
-- Exact manifests establish candidates, never deletion authorization.
BEGIN READ ONLY;
SET LOCAL statement_timeout = '60s';
SET LOCAL lock_timeout = '5s';
WITH
fixtures AS (
 SELECT value AS f FROM jsonb_array_elements($h171_manifests$
[
  {
    "path": ".h164-sync-evaluation/.evidence-h164/live-0f05350/fixtures.json",
    "sha256": "0074b6891fbf231eacbc04ac57d961baaddafda9e4ccf437e3aabdb0c8c3b128",
    "run": "ca80e903-4239-4fde-9a98-a93d163a5190",
    "prefix": "qa-h164-ca80e903-4239-4fde-9a98-a93d163a5190",
    "userId": "895b586d-15b7-40ae-8ce1-926492c2a229",
    "products": [
      "bc7bef43-5536-470f-8ce0-5c47b93264ca",
      "61eab90f-677f-40bb-b99d-af00b54aee7e",
      "d79246f1-c2fb-4c94-8ac3-91f5f8cb6182",
      "4fb31b4f-90a9-4adb-907b-df254b07ebb4",
      "ac0b80e2-9b3e-4dbf-b48e-4529ed0a22f3",
      "d9a5e36b-c68f-47f1-b085-eb46f8a0d814",
      "295d7846-9d6e-4179-b546-0a6ba9c463e1"
    ],
    "sellers": [
      "qa-h164-ca80e903-4239-4fde-9a98-a93d163a5190-admin",
      "qa-h164-ca80e903-4239-4fde-9a98-a93d163a5190-seller-A",
      "qa-h164-ca80e903-4239-4fde-9a98-a93d163a5190-seller-B",
      "qa-h164-ca80e903-4239-4fde-9a98-a93d163a5190-seller-C",
      "720db98c-e653-4d86-8d5e-eab00a315959"
    ],
    "sales": [
      "BG-260912-0001",
      "BG-260912-0003",
      "BG-260912-0002",
      "BG-260912-0006"
    ],
    "returns": [
      "ret-e5900729-5895-45bc-98fd-9491adb1782e",
      "ret-17855cbf-5bdd-4bac-8b9d-6324d14410d8"
    ],
    "exchanges": [
      "cmb-a0293bc4-59df-49f6-9c88-49bc27aee2b8",
      "cmb-ff893bef-389f-4b04-a82f-f6416b4980b5"
    ],
    "loans": [
      "6e5251bd-bcb7-490c-8eed-867a1298f338"
    ],
    "clients": [
      "cli-9ffc50f2-4b0e-44d9-9bd1-a01671b351c2"
    ],
    "promotions": [
      "promo-5627f55b-22d2-46fa-a98e-6c7ff525d95e"
    ],
    "operationIds": [
      "d802d040-2f20-46f7-a750-5ec220a61a12",
      "5627f55b-22d2-46fa-a98e-6c7ff525d95e",
      "1c776a20-2d34-44c9-92aa-af8058be9ac8",
      "cc2c0905-7415-4fc0-9561-55b222180aff",
      "e509bd10-6de2-4dce-9ad5-584b861c4a9b",
      "21bba717-6d92-47e3-9503-d042d7597860",
      "c7b6b62d-197f-4fb3-8ce5-d21fb69360ed",
      "e5900729-5895-45bc-98fd-9491adb1782e",
      "17855cbf-5bdd-4bac-8b9d-6324d14410d8",
      "ff893bef-389f-4b04-a82f-f6416b4980b5",
      "a0293bc4-59df-49f6-9c88-49bc27aee2b8",
      "0435350a-36e4-455d-a178-04372fe072b1",
      "80d6cf8c-a16f-4c0d-baf3-927f13aa6d20",
      "169f832b-6ece-420e-a183-94faed0e44e1",
      "f08f0360-74e8-4115-8c5f-3cf7aa9addbf",
      "9b313a8b-7eab-4319-b611-77f6c92f22d7",
      "a1f3d32f-7299-4902-9ad7-135b1deee8d3"
    ],
    "requestIds": [
      "39577f84-455e-4c4f-938a-59cbddc7afbe",
      "3ccd65f7-eb9a-4f82-a1b2-9c5cf566788a",
      "6b82c77c-ec9c-4d60-955d-479ba8252b5b",
      "617d444a-38a6-4466-a684-e5fb5e31caf7",
      "d66e5c07-28b2-465a-b656-25ac89aa5295",
      "82b68678-eed5-4907-abce-0016853dbedf",
      "8292d296-5759-44c3-b474-d36001f81a60",
      "7d2889fd-9d9b-4f09-818d-c3c302f6e4a7",
      "d802d040-2f20-46f7-a750-5ec220a61a12",
      "f5fe898c-515f-4378-8d43-eba8ccac2fd5",
      "6de5a627-1205-48a2-b997-92ec89e0bfb8",
      "cc2c0905-7415-4fc0-9561-55b222180aff",
      "b46e37a5-6169-5ffa-888e-7e3e8fc5b4ba",
      "e509bd10-6de2-4dce-9ad5-584b861c4a9b",
      "ee3f0c2a-facb-5ec0-8217-21a5210ead99",
      "03561d3f-254e-528c-8f2f-125f222c24a4",
      "c7b6b62d-197f-4fb3-8ce5-d21fb69360ed",
      "21bba717-6d92-47e3-9503-d042d7597860",
      "e5900729-5895-45bc-98fd-9491adb1782e",
      "17855cbf-5bdd-4bac-8b9d-6324d14410d8",
      "293b8d67-a5f3-5662-8964-9747443c569b",
      "2474609f-12dd-5fbc-819e-73730daa027d",
      "a0293bc4-59df-49f6-9c88-49bc27aee2b8",
      "ff893bef-389f-4b04-a82f-f6416b4980b5",
      "b9f618ca-9a25-52f2-8e30-6219fb803225",
      "54bcbc0f-9f6f-4bbb-94c9-c8e075db599a",
      "febe35ab-cff4-4e1b-a57f-4dfcd3938e6a",
      "3dd668ad-5bae-4355-a85e-1df830d25843",
      "a85331d9-6ee5-5544-8359-680b92d4cf44",
      "0435350a-36e4-455d-a178-04372fe072b1",
      "80d6cf8c-a16f-4c0d-baf3-927f13aa6d20",
      "169f832b-6ece-420e-a183-94faed0e44e1",
      "9b313a8b-7eab-4319-b611-77f6c92f22d7",
      "f08f0360-74e8-4115-8c5f-3cf7aa9addbf",
      "a1f3d32f-7299-4902-9ad7-135b1deee8d3",
      "b33bebcc-b50b-4623-abb0-b7de13815d8f",
      "149e3925-470e-4b17-9571-c6a74ff4a1cd",
      "3821c4ee-8cce-4bd8-8dc3-4ce2c6fe429a",
      "85cdb983-9dfc-4a42-b43b-a3a4ae13d3ac"
    ],
    "installations": [
      "qa-h164-ca80e903-4239-4fde-9a98-a93d163a5190-A",
      "qa-h164-ca80e903-4239-4fde-9a98-a93d163a5190-B",
      "qa-h164-ca80e903-4239-4fde-9a98-a93d163a5190-C"
    ],
    "configKeys": [
      "qa.h164.ca80e903-4239-4fde-9a98-a93d163a5190"
    ],
    "createdAccountIds": [
      "720db98c-e653-4d86-8d5e-eab00a315959"
    ],
    "accountRequestId": "1c776a20-2d34-44c9-92aa-af8058be9ac8",
    "startupAccountRequestId": null
  },
  {
    "path": ".h161-release/.evidence-h169-live/fixtures.json",
    "sha256": "211ccf13ec6e1c66643848640bef5bfdd013b147f41272a016223a80b447d923",
    "run": "2607cae4-404d-48bc-bdfc-6381b9c4a173",
    "prefix": "qa-h164-2607cae4-404d-48bc-bdfc-6381b9c4a173",
    "userId": "eb46cc84-1fe2-4da0-84b6-8332a7ff3bad",
    "products": [
      "0abfa7f5-6d8c-4edf-bfc8-0a7e87b0df03",
      "49d6e6ba-3054-48e3-942d-fd2c6a5678cb",
      "1c329b33-1478-4316-83b2-0c96b73d386f",
      "cf187ffb-b033-4c09-a669-8f5a8fdf84fb",
      "07e7f317-807e-4382-abd3-517f2f109484",
      "82b8863c-89dd-47be-8b4b-e81c66e202e3",
      "6cf88a71-9c31-42f1-a446-cc4e27b8ac29"
    ],
    "sellers": [
      "qa-h164-2607cae4-404d-48bc-bdfc-6381b9c4a173-admin",
      "qa-h164-2607cae4-404d-48bc-bdfc-6381b9c4a173-seller-A",
      "qa-h164-2607cae4-404d-48bc-bdfc-6381b9c4a173-seller-B",
      "qa-h164-2607cae4-404d-48bc-bdfc-6381b9c4a173-seller-C",
      "0c854997-d4cb-4f5a-bf19-6640498c8219"
    ],
    "sales": [
      "BG-260912-0002",
      "BG-260912-0004",
      "BG-260912-0003",
      "BG-260912-0007"
    ],
    "returns": [
      "ret-b41e6094-19df-43fe-9f83-0aadc2687638",
      "ret-5e92d8f7-1cc5-4bbb-b4d3-404c4d833bab"
    ],
    "exchanges": [
      "cmb-3ba2082f-8e49-45de-8110-7d0f628dff05",
      "cmb-9afed25f-366c-402e-a325-613e5ff57c4d"
    ],
    "loans": [
      "fed8cad9-45a8-4e74-b89a-204aa8212251"
    ],
    "clients": [
      "cli-09c8e0ba-c818-472c-af7b-0bdc399dfcd8"
    ],
    "promotions": [
      "promo-1bf1bb50-5d45-480f-829f-b78031a13e4e"
    ],
    "operationIds": [
      "3b047130-42aa-4a45-887d-9d7b90f53a85",
      "1bf1bb50-5d45-480f-829f-b78031a13e4e",
      "2e5f432d-17ec-4b5a-a536-d2eb93cc188d",
      "7caf3a20-90f4-4ec1-81d5-17d54b4f666e",
      "55dc5ef6-9300-4b20-bae8-5ff9d9e9738d",
      "264a5317-4a12-49c0-bd6f-39b61163b518",
      "bc088419-d9c5-45c7-b7de-063b70e230bd",
      "b41e6094-19df-43fe-9f83-0aadc2687638",
      "5e92d8f7-1cc5-4bbb-b4d3-404c4d833bab",
      "9afed25f-366c-402e-a325-613e5ff57c4d",
      "3ba2082f-8e49-45de-8110-7d0f628dff05",
      "d50de195-573a-49b3-9e7a-0cf94bf1a4c6",
      "2f16bfba-e336-4c45-8ffd-a886f00b202c",
      "4a2acd8c-8ef4-46e5-ae64-ce526026c295",
      "070f8d45-1adf-4470-b471-8b9924ffaa0e"
    ],
    "requestIds": [
      "a4979bbb-7257-416c-8d4c-3d59756d7598",
      "a1a35333-6cfc-45e3-9012-de85625667f1",
      "7ffff353-df85-4e46-a131-ff6ad8f9b699",
      "d257be97-6720-47e9-8e52-d7450f84752c",
      "a5e8144a-89de-47ea-ad08-11b9f5a67df3",
      "e26bfab5-8ecd-47f0-b9af-6fae1c7cfd3e",
      "4ae7965e-cc5f-48c8-a350-237a9099a816",
      "d5bf7771-4944-4837-bdca-2eb6c9eaf4a3",
      "65295962-8cc5-49f1-bf25-9485a8948051",
      "3b047130-42aa-4a45-887d-9d7b90f53a85",
      "903166b8-6469-4ec1-8bb5-c768d99bad0b",
      "66c3b5e4-3cfc-4c29-a588-72edaddd2ad8",
      "7caf3a20-90f4-4ec1-81d5-17d54b4f666e",
      "0925efcc-8e6b-5f2d-8a10-e6086c75d33e",
      "55dc5ef6-9300-4b20-bae8-5ff9d9e9738d",
      "f9e2341c-4589-539d-8213-c149198b68ec",
      "23d69450-975a-51e6-8eb4-1df64f381aaf",
      "bc088419-d9c5-45c7-b7de-063b70e230bd",
      "264a5317-4a12-49c0-bd6f-39b61163b518",
      "b41e6094-19df-43fe-9f83-0aadc2687638",
      "5e92d8f7-1cc5-4bbb-b4d3-404c4d833bab",
      "64937958-558a-5ac2-85d3-ef74c0fa926b",
      "e530ca97-654e-5a6e-8c4e-f09b716eeb76",
      "3ba2082f-8e49-45de-8110-7d0f628dff05",
      "9afed25f-366c-402e-a325-613e5ff57c4d",
      "31fe6e28-fe2d-50bb-81d5-67ec308dd0cd",
      "01bbe1e4-59cd-4f6c-af40-100364b35dac",
      "98da83b4-9ad0-42f7-8977-eccde9370140",
      "5f217e19-be57-41c3-ac03-0ebda4659411",
      "22826ab4-847f-5791-8d6f-7c8b9af1750c",
      "d50de195-573a-49b3-9e7a-0cf94bf1a4c6",
      "2f16bfba-e336-4c45-8ffd-a886f00b202c",
      "4a2acd8c-8ef4-46e5-ae64-ce526026c295",
      "070f8d45-1adf-4470-b471-8b9924ffaa0e",
      "9bd6a6ad-bfa3-4cbd-8af5-0274e12c1fee",
      "f203527d-209a-4e9b-9ee5-2d8034727833",
      "3385586d-78ec-49bb-9801-6a66b1b819b6",
      "a04b01f8-e210-4c4f-8fcf-8f0897955461"
    ],
    "installations": [
      "qa-h164-2607cae4-404d-48bc-bdfc-6381b9c4a173-A",
      "qa-h164-2607cae4-404d-48bc-bdfc-6381b9c4a173-B",
      "qa-h164-2607cae4-404d-48bc-bdfc-6381b9c4a173-C"
    ],
    "configKeys": [
      "qa.h164.2607cae4-404d-48bc-bdfc-6381b9c4a173"
    ],
    "createdAccountIds": [
      "0c854997-d4cb-4f5a-bf19-6640498c8219"
    ],
    "accountRequestId": "2e5f432d-17ec-4b5a-a536-d2eb93cc188d",
    "startupAccountRequestId": null
  },
  {
    "path": ".h161-release/.evidence-h170-live/fixtures.json",
    "sha256": "50909e60f161c1c1c4fa4737fcb8af35ed4a351303893967b644d5d841734dad",
    "run": "8a89fd93-552a-489d-ae6b-e0afabf899e7",
    "prefix": "qa-h164-8a89fd93-552a-489d-ae6b-e0afabf899e7",
    "userId": "272aed8a-fab0-48e0-b2ba-e65d3f0884b9",
    "products": [
      "eb82cb4c-16c3-4c3c-9662-06323693df84",
      "a7e2bc67-2f72-4e1f-90b2-e72acb8fd7be",
      "6a6375de-ecbf-4824-a062-907c838c36e4",
      "0fca850b-087c-481c-ac05-17e9e058bb7c",
      "c5a3b49d-f94c-423b-84e1-d02a8d97c4c0",
      "81e59ebd-fa9d-41f7-81ee-af0a722b9fab",
      "3804757b-5bda-404b-8c39-f215b21f2d43"
    ],
    "sellers": [
      "qa-h164-8a89fd93-552a-489d-ae6b-e0afabf899e7-admin",
      "qa-h164-8a89fd93-552a-489d-ae6b-e0afabf899e7-seller-A",
      "qa-h164-8a89fd93-552a-489d-ae6b-e0afabf899e7-seller-B",
      "qa-h164-8a89fd93-552a-489d-ae6b-e0afabf899e7-seller-C",
      "85fd870d-1d81-484b-84d3-de60cd2576ec"
    ],
    "sales": [
      "BG-260912-0008",
      "BG-260912-0009",
      "BG-260912-0010",
      "BG-260912-0011",
      "BG-260912-0014"
    ],
    "returns": [
      "ret-c16c6b8b-f70d-4c89-94b5-931024dfadcc",
      "ret-71e7d2e5-b0b4-4ad4-b808-4d74388cf16d"
    ],
    "exchanges": [
      "cmb-dfc5082a-9d9f-4143-b986-d716e7793a82",
      "cmb-eac348da-0735-4473-82de-fdb32f375abe"
    ],
    "loans": [
      "a71c95cd-53b6-421d-9018-8948f077b51c"
    ],
    "clients": [
      "cli-c6c85a94-12c3-4ec6-9bc9-7fdc0477ef8a"
    ],
    "promotions": [
      "promo-6492bfd8-1c4a-4122-8896-64f0830aa9d4"
    ],
    "operationIds": [
      "abcd0dc8-c5d1-406a-b578-be688a535683",
      "e37fd019-e694-4827-9a7d-1c1cb96b8438",
      "6492bfd8-1c4a-4122-8896-64f0830aa9d4",
      "d69b9b5d-60d8-492c-a0eb-55dba58887f1",
      "ef068fe3-f29d-49bb-b2bd-2ce34884d912",
      "3cb959ec-ca9f-4e52-b83e-6d829171634e",
      "c652df23-8a36-45da-9287-91af1647c94b",
      "b857ae81-cb1c-41ed-b630-3f4efebe3789",
      "b900be89-c30d-4f97-8e1c-a8914f98acd6",
      "71e7d2e5-b0b4-4ad4-b808-4d74388cf16d",
      "c16c6b8b-f70d-4c89-94b5-931024dfadcc",
      "dfc5082a-9d9f-4143-b986-d716e7793a82",
      "eac348da-0735-4473-82de-fdb32f375abe",
      "2bb786c0-3251-4048-871d-b0814ad6289a",
      "30826fca-b1f5-496e-a57f-8f74e36915aa",
      "6bb4dddc-276e-4989-9428-386994651968",
      "81403397-2584-4227-94bb-f0f5d2c473f8"
    ],
    "requestIds": [
      "23239f78-8405-40a0-83dd-17f3dc201c6a",
      "eb4dc68f-2ff3-41e2-9b24-501e30149420",
      "63a83df6-9375-4f1c-bb3e-889296951324",
      "89397420-9cb5-4cba-8bf6-9380d8fbd6f6",
      "d6879d47-1766-41a4-b574-8f5b8ebb44a3",
      "b16d744d-eb7c-4178-bbd7-ed0f108e2cab",
      "f8c9f9fa-4d96-4c9a-b857-9996dcc725f8",
      "130bf243-3f5c-4588-9554-a84952ac3ea1",
      "e37fd019-e694-4827-9a7d-1c1cb96b8438",
      "78933a5e-d8d6-439e-888f-8aa55b495b59",
      "579b90dc-2ac8-4c6f-80bc-3f4a7ebdcd49",
      "ef068fe3-f29d-49bb-b2bd-2ce34884d912",
      "a3a52802-5daf-53e2-89a8-25eda1d2924f",
      "3cb959ec-ca9f-4e52-b83e-6d829171634e",
      "3ec9543d-e353-526e-8dc7-31f1285c9bcf",
      "c652df23-8a36-45da-9287-91af1647c94b",
      "89954830-bc2e-575b-8683-67cb015e2096",
      "022dcc72-7aab-5a0f-8b7a-e7c9f9fadf7d",
      "b857ae81-cb1c-41ed-b630-3f4efebe3789",
      "b900be89-c30d-4f97-8e1c-a8914f98acd6",
      "c16c6b8b-f70d-4c89-94b5-931024dfadcc",
      "71e7d2e5-b0b4-4ad4-b808-4d74388cf16d",
      "9d0d962c-4e7b-59a0-8c17-2e4cba69761f",
      "f79cb85c-a166-5fa8-856f-f1f586a9b8a4",
      "dfc5082a-9d9f-4143-b986-d716e7793a82",
      "eac348da-0735-4473-82de-fdb32f375abe",
      "6154d785-cc7f-5e12-8bbd-911180689ede",
      "36ef32ce-eb02-4adb-a2a9-02a470e96f67",
      "cfeef958-e192-456d-99cb-dff9c75deb12",
      "83edec6a-9544-4ac5-95ce-6a3d3d646eb2",
      "b337a3dd-7c1c-5045-8d80-c5a9b8d1fc00",
      "2bb786c0-3251-4048-871d-b0814ad6289a",
      "30826fca-b1f5-496e-a57f-8f74e36915aa",
      "6bb4dddc-276e-4989-9428-386994651968",
      "81403397-2584-4227-94bb-f0f5d2c473f8",
      "b7e4c766-420f-4ee9-91bd-0d64ef4543e9",
      "f2c73e99-b37f-44da-a2d9-5d1299ba33de",
      "19287dae-5045-4e88-aa76-a537dfae0e6c",
      "ddf5be41-46c8-41b4-b547-bc821cb93388"
    ],
    "installations": [
      "qa-h164-8a89fd93-552a-489d-ae6b-e0afabf899e7-A",
      "qa-h164-8a89fd93-552a-489d-ae6b-e0afabf899e7-B",
      "qa-h164-8a89fd93-552a-489d-ae6b-e0afabf899e7-C"
    ],
    "configKeys": [
      "qa.h164.8a89fd93-552a-489d-ae6b-e0afabf899e7"
    ],
    "createdAccountIds": [
      "85fd870d-1d81-484b-84d3-de60cd2576ec"
    ],
    "accountRequestId": "d69b9b5d-60d8-492c-a0eb-55dba58887f1",
    "startupAccountRequestId": "abcd0dc8-c5d1-406a-b578-be688a535683"
  }
]
$h171_manifests$::jsonb)
),
table_names(table_name) AS (VALUES
 ('products'),
 ('clients'),
 ('sellers'),
 ('promotions'),
 ('sales'),
 ('sale_items'),
 ('sale_payments'),
 ('returns'),
 ('return_items'),
 ('exchanges'),
 ('exchange_items'),
 ('movements'),
 ('loan_documents'),
 ('liquidations'),
 ('commission_adjustments'),
 ('lookup'),
 ('settings'),
 ('stock_reservations'),
 ('sale_commits'),
 ('return_commits'),
 ('exchange_commits'),
 ('layaway_liquidation_commits'),
 ('reference_reclassifications'),
 ('physical_card_redemptions'),
 ('folio_counters'),
 ('config_commits'),
 ('config_sync_state'),
 ('screen_permission_catalog'),
 ('screen_permission_catalog_state'),
 ('user_permission_role_assignments'),
 ('role_screen_permissions'),
 ('user_screen_permission_overrides'),
 ('user_capability_overrides'),
 ('role_capability_permissions'),
 ('permission_roles'))
,
business_rows AS MATERIALIZED (
 SELECT 'products'::text AS table_name, to_jsonb(t) AS j FROM pos.products t
 UNION ALL
 SELECT 'clients'::text AS table_name, to_jsonb(t) AS j FROM pos.clients t
 UNION ALL
 SELECT 'sellers'::text AS table_name, to_jsonb(t) AS j FROM pos.sellers t
 UNION ALL
 SELECT 'promotions'::text AS table_name, to_jsonb(t) AS j FROM pos.promotions t
 UNION ALL
 SELECT 'sales'::text AS table_name, to_jsonb(t) AS j FROM pos.sales t
 UNION ALL
 SELECT 'sale_items'::text AS table_name, to_jsonb(t) AS j FROM pos.sale_items t
 UNION ALL
 SELECT 'sale_payments'::text AS table_name, to_jsonb(t) AS j FROM pos.sale_payments t
 UNION ALL
 SELECT 'returns'::text AS table_name, to_jsonb(t) AS j FROM pos.returns t
 UNION ALL
 SELECT 'return_items'::text AS table_name, to_jsonb(t) AS j FROM pos.return_items t
 UNION ALL
 SELECT 'exchanges'::text AS table_name, to_jsonb(t) AS j FROM pos.exchanges t
 UNION ALL
 SELECT 'exchange_items'::text AS table_name, to_jsonb(t) AS j FROM pos.exchange_items t
 UNION ALL
 SELECT 'movements'::text AS table_name, to_jsonb(t) AS j FROM pos.movements t
 UNION ALL
 SELECT 'loan_documents'::text AS table_name, to_jsonb(t) AS j FROM pos.loan_documents t
 UNION ALL
 SELECT 'liquidations'::text AS table_name, to_jsonb(t) AS j FROM pos.liquidations t
 UNION ALL
 SELECT 'commission_adjustments'::text AS table_name, to_jsonb(t) AS j FROM pos.commission_adjustments t
 UNION ALL
 SELECT 'lookup'::text AS table_name, to_jsonb(t) AS j FROM pos.lookup t
 UNION ALL
 SELECT 'settings'::text AS table_name, to_jsonb(t) AS j FROM pos.settings t
 UNION ALL
 SELECT 'stock_reservations'::text AS table_name, to_jsonb(t) AS j FROM pos.stock_reservations t
 UNION ALL
 SELECT 'sale_commits'::text AS table_name, to_jsonb(t) AS j FROM pos.sale_commits t
 UNION ALL
 SELECT 'return_commits'::text AS table_name, to_jsonb(t) AS j FROM pos.return_commits t
 UNION ALL
 SELECT 'exchange_commits'::text AS table_name, to_jsonb(t) AS j FROM pos.exchange_commits t
 UNION ALL
 SELECT 'layaway_liquidation_commits'::text AS table_name, to_jsonb(t) AS j FROM pos.layaway_liquidation_commits t
 UNION ALL
 SELECT 'reference_reclassifications'::text AS table_name, to_jsonb(t) AS j FROM pos.reference_reclassifications t
 UNION ALL
 SELECT 'physical_card_redemptions'::text AS table_name, to_jsonb(t) AS j FROM pos.physical_card_redemptions t
 UNION ALL
 SELECT 'folio_counters'::text AS table_name, to_jsonb(t) AS j FROM pos.folio_counters t
 UNION ALL
 SELECT 'config_commits'::text AS table_name, to_jsonb(t) AS j FROM pos.config_commits t
 UNION ALL
 SELECT 'config_sync_state'::text AS table_name, to_jsonb(t) AS j FROM pos.config_sync_state t
 UNION ALL
 SELECT 'screen_permission_catalog'::text AS table_name, to_jsonb(t) AS j FROM pos.screen_permission_catalog t
 UNION ALL
 SELECT 'screen_permission_catalog_state'::text AS table_name, to_jsonb(t) AS j FROM pos.screen_permission_catalog_state t
 UNION ALL
 SELECT 'user_permission_role_assignments'::text AS table_name, to_jsonb(t) AS j FROM pos.user_permission_role_assignments t
 UNION ALL
 SELECT 'role_screen_permissions'::text AS table_name, to_jsonb(t) AS j FROM pos.role_screen_permissions t
 UNION ALL
 SELECT 'user_screen_permission_overrides'::text AS table_name, to_jsonb(t) AS j FROM pos.user_screen_permission_overrides t
 UNION ALL
 SELECT 'user_capability_overrides'::text AS table_name, to_jsonb(t) AS j FROM pos.user_capability_overrides t
 UNION ALL
 SELECT 'role_capability_permissions'::text AS table_name, to_jsonb(t) AS j FROM pos.role_capability_permissions t
 UNION ALL
 SELECT 'permission_roles'::text AS table_name, to_jsonb(t) AS j FROM pos.permission_roles t
),
keyed_rows AS MATERIALIZED (
 SELECT table_name, j,
  CASE table_name WHEN 'sales' THEN j->>'folio' WHEN 'settings' THEN j->>'key'
   WHEN 'commission_adjustments' THEN j->>'operation_id'
   WHEN 'stock_reservations' THEN coalesce(j->>'operation_id',j->>'id')
   ELSE coalesce(j->>'id',j->>'operation_id',j->>'commit_id',j->>'alias_code',
    j->>'screen_key',j->>'user_id',j->>'role_code',j->>'code',j->>'singleton',md5(j::text)) END AS row_id,
  md5(j::text) AS row_md5
 FROM business_rows
),
roots AS (
 SELECT f->>'run' AS run, 'products'::text AS table_name, value AS row_id
 FROM fixtures CROSS JOIN LATERAL jsonb_array_elements_text(f->'products')
 UNION ALL
 SELECT f->>'run' AS run, 'clients'::text AS table_name, value AS row_id
 FROM fixtures CROSS JOIN LATERAL jsonb_array_elements_text(f->'clients')
 UNION ALL
 SELECT f->>'run' AS run, 'sellers'::text AS table_name, value AS row_id
 FROM fixtures CROSS JOIN LATERAL jsonb_array_elements_text(f->'sellers')
 UNION ALL
 SELECT f->>'run' AS run, 'sales'::text AS table_name, value AS row_id
 FROM fixtures CROSS JOIN LATERAL jsonb_array_elements_text(f->'sales')
 UNION ALL
 SELECT f->>'run' AS run, 'returns'::text AS table_name, value AS row_id
 FROM fixtures CROSS JOIN LATERAL jsonb_array_elements_text(f->'returns')
 UNION ALL
 SELECT f->>'run' AS run, 'exchanges'::text AS table_name, value AS row_id
 FROM fixtures CROSS JOIN LATERAL jsonb_array_elements_text(f->'exchanges')
 UNION ALL
 SELECT f->>'run' AS run, 'loan_documents'::text AS table_name, value AS row_id
 FROM fixtures CROSS JOIN LATERAL jsonb_array_elements_text(f->'loans')
 UNION ALL
 SELECT f->>'run' AS run, 'promotions'::text AS table_name, value AS row_id
 FROM fixtures CROSS JOIN LATERAL jsonb_array_elements_text(f->'promotions')
 UNION ALL
 SELECT f->>'run' AS run, 'settings'::text AS table_name, value AS row_id
 FROM fixtures CROSS JOIN LATERAL jsonb_array_elements_text(f->'configKeys')
),
qa_actors AS (
 SELECT f->>'run' AS run, f->>'userId' AS actor_id FROM fixtures
),
qa_auth_ids AS (
 SELECT f->>'run' AS run, f->>'userId' AS user_id FROM fixtures
 UNION ALL SELECT f->>'run',value FROM fixtures
 CROSS JOIN LATERAL jsonb_array_elements_text(f->'createdAccountIds')
),
online_receipts AS MATERIALIZED (
 SELECT to_jsonb(r) AS j FROM pos.online_requests r
),
sale_evidence AS (
 SELECT f->>'run' AS run, folio.value AS folio, s.j IS NOT NULL AS remote_exists,
  s.j->>'cliente_id' AS remote_client_id, s.j->>'operation_id' AS remote_operation_id,
  coalesce(f->'clients' ? (s.j->>'cliente_id'),false) AS client_matches,
  (SELECT count(*) FROM business_rows i WHERE i.table_name='sale_items' AND i.j->>'folio'=folio.value) AS line_count,
  NOT EXISTS(SELECT 1 FROM business_rows i WHERE i.table_name='sale_items' AND i.j->>'folio'=folio.value
    AND NOT coalesce(f->'products' ? (i.j->>'product_id'),false)) AS all_line_products_match,
  EXISTS(SELECT 1 FROM online_receipts r WHERE r.j->>'actor_id'=f->>'userId'
   AND f->'requestIds' ? (r.j->>'request_id') AND r.j->>'state'='confirmed'
   AND jsonb_path_exists(r.j,'$.response.**.folio ? (@ == $folio)',jsonb_build_object('folio',folio.value))) AS confirmed_actor_receipt_matches,
  (SELECT coalesce(jsonb_agg(r.j->>'request_id' ORDER BY r.j->>'request_id'),'[]'::jsonb)
   FROM online_receipts r WHERE r.j->>'actor_id'=f->>'userId'
   AND f->'requestIds' ? (r.j->>'request_id') AND r.j->>'state'='confirmed'
   AND jsonb_path_exists(r.j,'$.response.**.folio ? (@ == $folio)',jsonb_build_object('folio',folio.value))) AS matching_request_ids
 FROM fixtures CROSS JOIN LATERAL jsonb_array_elements_text(f->'sales') folio
 LEFT JOIN business_rows s ON s.table_name='sales' AND s.j->>'folio'=folio.value
),
accepted_sales AS (
 SELECT run,folio FROM sale_evidence
 WHERE remote_exists AND client_matches AND line_count>0 AND all_line_products_match AND confirmed_actor_receipt_matches
),
matched_roots AS (
 SELECT r.*, b.j, b.row_md5,
  CASE WHEN b.j IS NULL THEN 'ABSENT'
   WHEN r.table_name='sales' AND NOT EXISTS(SELECT 1 FROM accepted_sales a WHERE a.run=r.run AND a.folio=r.row_id)
    THEN 'UNKNOWN_FOLIO_REUSED_OR_INSUFFICIENT_RECEIPT'
   ELSE 'EXACT_MANIFEST_ID_REQUIRES_FINAL_REVIEW' END AS classification
 FROM roots r LEFT JOIN keyed_rows b USING(table_name,row_id)
),
related_rows AS (
 SELECT DISTINCT f->>'run' AS run,b.table_name,b.row_id,b.row_md5,
  'DEPENDENCY_REQUIRES_SCOPE_REVIEW'::text AS classification
 FROM fixtures CROSS JOIN keyed_rows b
 WHERE
  (b.table_name IN('sale_items','sale_payments','stock_reservations','sale_commits','layaway_liquidation_commits')
   AND EXISTS(SELECT 1 FROM accepted_sales a WHERE a.run=f->>'run' AND a.folio=b.j->>'folio'))
 OR (b.table_name='physical_card_redemptions' AND EXISTS(SELECT 1 FROM accepted_sales a
   WHERE a.run=f->>'run' AND a.folio=b.j->>'sale_folio'))
 OR (b.table_name IN('return_items','return_commits') AND f->'returns' ? (b.j->>'return_id'))
 OR (b.table_name IN('exchange_items','exchange_commits') AND f->'exchanges' ? (b.j->>'exchange_id'))
 OR (b.table_name='sale_payments' AND f->'exchanges' ? (b.j->>'exchange_id'))
 OR (b.table_name='movements' AND (f->'products' ? (b.j->>'product_id')
   OR f->'returns' ? (b.j->>'return_id') OR f->'exchanges' ? (b.j->>'exchange_id')))
 OR (b.table_name='reference_reclassifications' AND
   (f->'products' ? (b.j->>'source_product_id') OR f->'products' ? (b.j->>'target_product_id')))
 OR (b.table_name='liquidations' AND f->'sellers' ? (b.j->>'seller_id'))
 OR (b.table_name IN('commission_adjustments','config_commits','stock_reservations')
   AND f->'operationIds' ? (b.j->>'operation_id'))
 OR (b.table_name IN('user_permission_role_assignments','user_screen_permission_overrides','user_capability_overrides')
   AND EXISTS(SELECT 1 FROM qa_auth_ids a WHERE a.run=f->>'run' AND a.user_id=b.j->>'user_id'))
),
unknown_markers AS (
 SELECT b.table_name,b.row_id,b.row_md5,'UNKNOWN_MARKER_ONLY'::text AS classification
 FROM keyed_rows b
 WHERE concat_ws(' ',b.row_id,b.j->>'nombre',b.j->>'modelo',b.j->>'notas',b.j->>'key')
  ~* '(^|[^a-z0-9])(qa[-_. ]|cert[-_. ]|fixture)'
 AND NOT EXISTS(SELECT 1 FROM roots r WHERE r.table_name=b.table_name AND r.row_id=b.row_id)
),
commercial_fingerprints AS (
 SELECT n.table_name,count(b.j) AS row_count,
  md5(coalesce(string_agg(b.row_md5,'' ORDER BY b.row_md5),'')) AS full_rows_md5,
  md5(coalesce(string_agg(md5((b.j-array['updated_at','sync_version','sync_base_version','sync_device_id'])::text),''
    ORDER BY md5((b.j-array['updated_at','sync_version','sync_base_version','sync_device_id'])::text)),'')) AS historical_semantics_md5
 FROM table_names n LEFT JOIN keyed_rows b USING(table_name) GROUP BY n.table_name
),
foreign_qa_product_links AS (
 SELECT DISTINCT b.table_name,b.row_id,b.row_md5,p.run,p.row_id AS referenced_qa_product_id,
  b.j->>'folio' AS parent_sale_folio,b.j->>'return_id' AS parent_return_id,b.j->>'exchange_id' AS parent_exchange_id,
  'REVIEW_EXTERNAL_REFERENCE_BEFORE_ANY_CLEANUP'::text AS classification
 FROM keyed_rows b JOIN roots p ON p.table_name='products' AND
  (b.j->>'product_id'=p.row_id OR b.j->>'source_product_id'=p.row_id OR b.j->>'target_product_id'=p.row_id)
 WHERE b.table_name IN('sale_items','return_items','exchange_items','movements','reference_reclassifications')
 AND NOT (
  EXISTS(SELECT 1 FROM accepted_sales a WHERE a.run=p.run AND a.folio=b.j->>'folio')
  OR EXISTS(SELECT 1 FROM roots r WHERE r.run=p.run AND
    ((r.table_name='returns' AND r.row_id=b.j->>'return_id') OR (r.table_name='exchanges' AND r.row_id=b.j->>'exchange_id')))
 )
),
auth_candidates AS (
 SELECT u.id::text AS user_id,md5(coalesce(u.email,'')) AS email_md5,u.banned_until,
  u.raw_user_meta_data->>'balam_online_test' AS declared_qa_run,
  u.raw_app_meta_data->>'balam_account_request_id' AS declared_qa_account_request,
  EXISTS(SELECT 1 FROM qa_auth_ids a WHERE a.user_id=u.id::text) AS exact_manifest_id,
  CASE WHEN EXISTS(SELECT 1 FROM qa_auth_ids a WHERE a.user_id=u.id::text) THEN 'EXACT_MANIFEST_ID_REQUIRES_FINAL_REVIEW'
    ELSE 'UNKNOWN_QA_MARKER_REQUIRES_PROVENANCE' END AS classification
 FROM auth.users u
 WHERE EXISTS(SELECT 1 FROM qa_auth_ids a WHERE a.user_id=u.id::text)
  OR u.raw_user_meta_data ? 'balam_online_test'
  OR coalesce(u.email,'') ~* '(^|[^a-z0-9])(qa[-_.]|cert[-_.]|fixture)'
),
asset_inventory AS (
 SELECT o.id::text AS object_id,o.bucket_id,md5(o.name) AS object_path_md5,
  coalesce(to_jsonb(o)->>'owner_id',to_jsonb(o)->>'owner') AS owner_id,
  o.metadata->>'size' AS declared_bytes,
  EXISTS(SELECT 1 FROM qa_auth_ids a WHERE a.user_id=coalesce(to_jsonb(o)->>'owner_id',to_jsonb(o)->>'owner')) AS exact_qa_owner,
  EXISTS(SELECT 1 FROM roots r WHERE r.table_name='products' AND position(r.row_id IN o.name)>0) AS exact_qa_product_id_in_path,
  (SELECT count(*) FROM business_rows b WHERE b.table_name IN('products','sellers','settings')
   AND position('/storage/v1/object/public/'||o.bucket_id||'/'||o.name IN b.j::text)>0) AS current_url_references,
  'UNKNOWN_UNTIL_REFERENCE_AND_STORAGE_REVIEW'::text AS classification
 FROM storage.objects o
 WHERE o.bucket_id IN('barcodes','product-photos')
)
SELECT jsonb_build_object(
 'audit','H171 BALAM read-only authority inventory',
 'expected_project_ref','telohdbvbvsfmwyriflz',
 'generated_at',clock_timestamp(),
 'transaction_read_only',current_setting('transaction_read_only'),
 'database',current_database(),
 'manifest',(SELECT jsonb_agg(to_jsonb(m)-'updated_by') FROM pos.system_manifest m),
 'online_runtime',(SELECT jsonb_agg(to_jsonb(r)) FROM pos.online_runtime r),
 'migrations',(SELECT jsonb_build_object('count',count(*),'latest',max(version)) FROM supabase_migrations.schema_migrations),
 'h156_authority',(SELECT coalesce(jsonb_agg(jsonb_build_object('function',p.oid::regprocedure::text,
   'definition_md5',md5(pg_get_functiondef(p.oid)),
   'checks_base_version',position('sync_base_version' IN pg_get_functiondef(p.oid))>0,
   'has_conflict_rejection',position('ENTITY_VERSION_CONFLICT' IN pg_get_functiondef(p.oid))>0,
   'has_for_update',position('for update' IN lower(pg_get_functiondef(p.oid)))>0,
   'contains_on_conflict',position('on conflict' IN lower(pg_get_functiondef(p.oid)))>0)
   ORDER BY p.proname),'[]'::jsonb) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='pos' AND p.proname IN('online_check_rows','online_save_entities','dispatch_online_command','execute_online_command')),
 'foreign_keys',(SELECT coalesce(jsonb_agg(jsonb_build_object('constraint',c.conname,
   'source',c.conrelid::regclass::text,'target',c.confrelid::regclass::text,
   'definition',pg_get_constraintdef(c.oid),'deferrable',c.condeferrable,'initially_deferred',c.condeferred)
   ORDER BY c.conrelid::regclass::text,c.conname),'[]'::jsonb)
   FROM pg_constraint c JOIN pg_class s ON s.oid=c.conrelid JOIN pg_namespace sn ON sn.oid=s.relnamespace
   JOIN pg_class t ON t.oid=c.confrelid JOIN pg_namespace tn ON tn.oid=t.relnamespace
   WHERE c.contype='f' AND (sn.nspname IN('pos','auth','storage') OR tn.nspname IN('pos','auth','storage'))),
 'columns',(SELECT coalesce(jsonb_agg(jsonb_build_object('schema',n.nspname,'table',c.relname,
   'column',a.attname,'type',format_type(a.atttypid,a.atttypmod),'not_null',a.attnotnull)
   ORDER BY n.nspname,c.relname,a.attnum),'[]'::jsonb)
   FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace
   WHERE a.attnum>0 AND NOT a.attisdropped AND c.relkind IN('r','p') AND
    (n.nspname='pos' OR (n.nspname='auth' AND c.relname IN('users','identities'))
     OR (n.nspname='storage' AND c.relname IN('objects','buckets')))),
 'commercial_fingerprints',(SELECT jsonb_agg(to_jsonb(x) ORDER BY table_name) FROM commercial_fingerprints x),
 'inventory_totals',(SELECT jsonb_build_object('all_rows',count(*),
   'active_rows',count(*) FILTER(WHERE j->>'deleted_at' IS NULL),
   'active_families',count(DISTINCT j->>'reference_family_id') FILTER(WHERE j->>'deleted_at' IS NULL),
   'active_v2_pieces',coalesce(sum((j->>'stock_quantity')::numeric) FILTER(WHERE j->>'deleted_at' IS NULL AND j->>'record_model'='v2'),0),
   'active_v1_rows',count(*) FILTER(WHERE j->>'deleted_at' IS NULL AND coalesce(j->>'record_model','v1')='v1'))
   FROM business_rows WHERE table_name='products'),
 'fixture_sources',(SELECT jsonb_agg(jsonb_build_object('run',f->>'run','path',f->>'path','sha256',f->>'sha256',
   'actor_id',f->>'userId','products_declared',jsonb_array_length(f->'products'),'sales_declared',jsonb_array_length(f->'sales')))
   FROM fixtures),
 'exact_roots',(SELECT coalesce(jsonb_agg(jsonb_build_object('run',run,'table',table_name,'id',row_id,
   'classification',classification,'row_md5',row_md5,'deleted_at',j->>'deleted_at','active',j->'active',
   'family_id',j->>'reference_family_id','stock_quantity',j->'stock_quantity','state',coalesce(j->>'estado',j->>'state'))
   ORDER BY run,table_name,row_id),'[]'::jsonb) FROM matched_roots),
 'sale_identity_evidence',(SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY run,folio),'[]'::jsonb) FROM sale_evidence x),
 'related_candidates',(SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY run,table_name,row_id),'[]'::jsonb) FROM related_rows x),
 'external_product_links',(SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY table_name,row_id),'[]'::jsonb) FROM foreign_qa_product_links x),
 'unknown_marker_candidates',(SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY table_name,row_id),'[]'::jsonb) FROM unknown_markers x),
 'auth_candidates',(SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY user_id),'[]'::jsonb) FROM auth_candidates x),
 'qa_account_requests',(SELECT coalesce(jsonb_agg(jsonb_build_object('actor_id',a.actor_id,'request_id',a.request_id,
   'target_user_id',a.target_user_id,'action',a.action,'state',a.state,'created_at',a.created_at,
   'target_is_known_qa',EXISTS(SELECT 1 FROM qa_auth_ids q WHERE q.user_id=a.target_user_id::text),
   'row_md5',md5(to_jsonb(a)::text)) ORDER BY a.created_at),'[]'::jsonb)
   FROM pos.online_account_requests a WHERE EXISTS(SELECT 1 FROM qa_auth_ids q
    WHERE q.user_id=a.actor_id::text OR q.user_id=a.target_user_id::text)
    OR a.request_id='70549527-4867-4342-94d2-38e770b0f2a9'::uuid),
 'outstanding_requests',(SELECT coalesce(jsonb_agg(jsonb_build_object('actor_id',r.j->>'actor_id',
   'request_id',r.j->>'request_id','kind',r.j->>'command_kind','device_id',r.j->>'device_id',
   'state',r.j->>'state','created_at',r.j->>'created_at')),'[]'::jsonb)
   FROM online_receipts r WHERE r.j->>'state'='executing'),
 'legacy_summary',(SELECT coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) FROM
   (SELECT 'archives'::text AS kind,classification,count(*) AS row_count FROM pos.online_legacy_archives GROUP BY classification
    UNION ALL SELECT 'operations',classification,count(*) FROM pos.online_legacy_operations GROUP BY classification) x),
 'devices',(SELECT jsonb_build_object('all',count(*),'active',count(*) FILTER(WHERE status<>'revoked'),
   'qa_marker_active',count(*) FILTER(WHERE status<>'revoked' AND device_id ~* '(^|[^a-z0-9])qa[-_.]'),
   'exact_fixtures',(SELECT coalesce(jsonb_agg(jsonb_build_object('device_id',d.device_id,'status',d.status,
    'queue_pending',to_jsonb(d)->'queue_pending','queue_blocked',to_jsonb(d)->'queue_blocked',
    'last_seen_at',to_jsonb(d)->'last_seen_at')),'[]'::jsonb) FROM pos.sync_devices d
     WHERE EXISTS(SELECT 1 FROM fixtures WHERE f->'installations' ? d.device_id))) FROM pos.sync_devices),
 'inventory_links',(SELECT jsonb_build_object(
   'aliases',(SELECT coalesce(jsonb_agg(jsonb_build_object('product_id',a.product_id,'alias_md5',md5(a.alias_code),
    'operation_id',a.operation_id)),'[]'::jsonb) FROM pos.barcode_aliases a
    WHERE EXISTS(SELECT 1 FROM roots r WHERE r.table_name='products' AND r.row_id=a.product_id)),
   'v1_v2_maps',(SELECT coalesce(jsonb_agg(jsonb_build_object('source_product_id',m.source_v1_product_id,
    'target_product_id',m.target_v2_product_id,'operation_id',m.operation_id)),'[]'::jsonb)
    FROM pos.inventory_v1_v2_map m WHERE EXISTS(SELECT 1 FROM roots r
      WHERE r.table_name='products' AND (r.row_id=m.target_v2_product_id OR r.row_id=m.source_v1_product_id))))),
 'qa_capability_audit',(SELECT jsonb_build_object('count',count(*),'by_actor',
   (SELECT coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) FROM
    (SELECT actor_user_id,count(*) AS row_count FROM pos.capability_operation_audit a
     WHERE EXISTS(SELECT 1 FROM qa_auth_ids q WHERE q.user_id=a.actor_user_id::text) GROUP BY actor_user_id) x))
   FROM pos.capability_operation_audit a WHERE EXISTS(SELECT 1 FROM qa_auth_ids q WHERE q.user_id=a.actor_user_id::text)),
 'storage_objects',(SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY bucket_id,object_id),'[]'::jsonb) FROM asset_inventory x),
 'limitations',jsonb_build_array('Read-only report; not a backup and no deletion authorization.',
   'Known fixture IDs may be absent or belong to an interrupted request. Folios can be reused after Punto Cero.',
   'UNKNOWN markers and unreferenced Storage objects require provenance review, never automatic deletion.',
   'Opaque row MD5 fingerprints compare state; raw originals must be backed up separately before approved cleanup.',
   'Physical browser localStorage/IndexedDB/PWA adoption cannot be certified from database telemetry.',
   'SQL expected_project_ref is a declaration; verify the CLI project link before running.')
) AS report;
COMMIT;

