-- H-10: las semillas puente nunca forman parte del dominio final.

delete from pos.products where id = '__h10_clean_product__';
delete from pos.clients where id = '__h10_clean_client__';
