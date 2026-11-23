-- @add-column-if-missing ATENDIMENTO exames_solicitados INTEGER
UPDATE ATENDIMENTO SET exames_solicitados=0 WHERE exames_solicitados IS NULL;
